# 서비스 범용화 리팩토링 플랜 — 프로필(비밀번호 ↔ 시트 ↔ 모드)

> 무엇을/왜는 `docs/PRD-general.md`가 정의한다. 이 문서는 **어떻게/어떤 순서로**를 정한다 — 영향 범위, 작업 분해(이슈 후보), 마이그레이션, 테스트 전략.
>
> 작성일: 2026-07-21 · 상태: **확정** — 같은 날 소유자 확인으로 PRD-general §10 Q1~Q4 해소, **코드 착수 가능**. Q5(홈 표기 디테일)만 작업 4의 design-prd 개정에서 확정한다.

---

## 1. 배경·목표

- v1은 비밀번호 1개(`APP_PASSWORD`) = 스프레드시트 1개(`SHEET_ID`) = 모드 2종 고정. 이 세 상수를 **프로필** 차원으로 묶어 범용화한다: 비밀번호 → 스프레드시트, 스프레드시트별 모드 구성(m1만 / m2만 / 둘 다).
- 목표: Worker 1개·SPA 1개·시트 컬럼 계약을 유지한 채 프로필 차원만 추가한다. 학습 모델은 "활성 모드 집합 M으로 파라미터화"가 전부이고, M = {m1,m2}일 때 기존 동작과 완전히 일치해야 한다 (기존 테스트가 그대로 통과하는 것이 그 증명). 비중국어 시트는 `contentType: "generic"` 프로필로 수용하되 **렌더링·등록 노출 분기까지만** (PRD-general §7·§10 Q4).
- 비목표: 회원가입·멀티테넌트 SaaS화, **등록 화면의 콘텐츠 일반화**(비중국어 검증·추출 킷 — 후속 플랜으로 분리), SRS 알고리즘 변경, 화면 구조 변경.

## 2. 전체 구조

```
[브라우저 SPA]
   │ Bearer <비밀번호>
   ▼
[Worker]
   1. resolveProfile(request, env)      ← 신규: 비밀번호 → 프로필 (실패: 401 / 설정 오류: 500)
   2. 라우트 핸들러(request, env, profile)
   3. Sheets 호출은 전부 profile.sheetId  ← env.SHEET_ID 직접 참조 제거
   ▼
[프로필별 스프레드시트 × N]  (서비스 계정·토큰 캐시는 공용)
```

요청 수명주기에서 바뀌는 것은 1(프로필 해석)과 3(sheetId 주입)뿐이다. 클라이언트는 프로필 정보(`id`·`name`·`modes`)를 health(로그인 시)·words(홈 진입마다) 응답으로 받아, 학습 로직에 `modes`를 넘긴다.

## 3. 영향 범위 (파일 단위)

### 3.1 Worker

| 파일 | 변경 |
|---|---|
| `worker/lib/profiles.ts` **(신규)** | `PROFILES` 파싱·검증(중복 password/id·빈 modes·잘못된 contentType 거부, contentType 생략 시 `"zh"`)·isolate 캐시, `APP_PASSWORD`+`SHEET_ID` 폴백 합성. 구성 오류는 구분 가능한 에러로 던져 index.ts가 500으로 변환 |
| `worker/lib/auth.ts` | `isAuthorized(request, env): boolean` → `resolveProfile(request, env): Profile \| null`. 다이제스트 캐시를 프로필 배열 기준으로 확장, 상수시간 비교는 그대로 |
| `worker/index.ts` | 인증 분기에서 프로필 해석 → 각 핸들러에 전달. 설정 오류 500 분기 추가. `/api/health` 응답에 `profile` 블록 |
| `worker/lib/sheets.ts` | 전 함수의 `env.SHEET_ID` → `sheetId` 파라미터화 (`sheetsFetch` 시그니처 변경이 근원, 나머지는 전파) |
| `worker/lib/words.ts` | `getWordTabTitles`·`findWordRow`·`findRowNumber`에 sheetId 전파. 파서(`parseWordRow`)·행 재탐색 로직 불변 |
| `worker/lib/answer.ts` | `computeAnswerUpdate`의 졸업 판정(`wasGraduated`/`justGraduated`)에 `modes` 파라미터 — "M의 모든 모드 ≥ 3" |
| `worker/routes/words.ts` | 프로필 스레딩 + 응답에 `profile` 블록 |
| `worker/routes/answer.ts` | 프로필 스레딩 + `mode ∉ modes → 400` + `computeAnswerUpdate`에 modes 전달 |
| `worker/routes/review-fail.ts` · `tabs.ts` · `register.ts` | 프로필 스레딩만 (계약 불변) |

### 3.2 클라이언트

| 파일 | 변경 |
|---|---|
| `src/lib/api.ts` | 프로필 저장/조회/삭제(키 `vocab-study:profile`), `verifyPassword`가 health 응답의 `profile` 반환, `clearPassword` 시 프로필도 삭제 |
| `src/lib/wordsApi.ts` | `fetchWords`가 `{ profile, words }`를 반환하도록 확장 (응답 계약 미러) |
| `src/lib/wordState.ts` | `getWordState(word, today, modes)` — 학습 중/졸업 판정을 M 기준으로 |
| `src/lib/sessionQueue.ts` | `buildSessionQueue(words, today, modes, rng)` — `randomMode`·`learningMode`를 M 제한판으로 |
| `src/lib/homeStats.ts` | `computeHomeStats(words, today, modes)` — 전달만 |
| `src/lib/retryQueue.ts` | 엔트리 `profileId` 태깅, 현재 프로필 항목만 flush(타 프로필 항목 보존), 무태그 레거시 승격, **4xx 폐기·계속 / 네트워크·5xx 중단·유지** 분리 — postAnswer/postReviewFail가 상태 코드를 식별 가능하게 던지도록 api.ts 오류 형태도 손본다 |
| `src/screens/LoginScreen.tsx` | 검증 성공 시 프로필 저장 |
| `src/screens/HomeScreen.tsx` | words 응답의 프로필 사용(이름 표기·저장본 갱신·modes를 집계/큐에 전달), "프로필 전환" 링크, **"단어 등록 ›" 링크를 `contentType === "zh"`일 때만 노출** |
| `src/App.tsx` | 프로필 전환 핸들러(저장값 삭제 → login 화면), StudyScreen에 프로필(contentType) 전달 |
| `StudyScreen` · `Mode1Card` · `Mode2Card` | 렌더링만 분기: `zh` 전용 처리(한자 크기 스케일·`lang="zh-Hans"`·모드 2 입력란 중국어 속성·칩 문구) vs `generic` 일반 텍스트, **B열 빈칸 시 보조 표기 줄 숨김(공통)** — 진행 로직은 불변 |
| `src/lib/hanziSize.ts` | `zh` 전용으로 유지 (generic 크기 규칙은 design-prd 개정에서) |
| `src/lib/studySession.ts` · `DoneScreen` | **불변** — 출제 모드는 큐가 이미 결정한 상태로 내려온다 |
| `src/screens/RegisterScreen.tsx` · 등록 검증 일체 | **불변** — 진입 링크가 `zh` 전용이 될 뿐, 화면 내부는 그대로 (콘텐츠 일반화는 후속 플랜) |

### 3.3 문서·운영

| 대상 | 변경 |
|---|---|
| `docs/PRD.md` | 머리에 범용화 개정 포인터 (이 브랜치에서 반영) |
| `docs/design-prd.md` | §2 로그인(프로필 저장)·§3 홈(이름 표기·전환 링크·등록 링크 zh 전용) 개정은 작업 4(Q5 확정 포함), §4 학습(zh/generic 렌더링·B열 빈칸 숨김) 개정은 작업 6 |
| `wrangler.jsonc` | `SHEET_ID` var에 폴백 전용 주석 → 정리 단계(작업 6)에서 제거 |
| `scripts/deploy-auth-smoke.sh` · `.github/workflows/smoke.yml` | **불변** — 무인증 401 검사 그대로, `SMOKE_PASSWORD`는 아무 프로필의 비밀번호로 유효 |
| `docs/registration-kit/` | 불변 |

## 4. 작업 분해 (이슈 후보)

| # | 내용 | 산출물 | 의존 |
|---|---|---|---|
| 0 | ~~**PRD 확정**~~ — **완료** (2026-07-21 소유자 확인 Q1~Q4, 문서 개정 반영) | 문서 2건 확정 | — |
| 1 | **Worker 프로필 기반** — `profiles.ts`(파싱·검증·폴백·캐시) + auth를 `resolveProfile`로 개정 + 설정 오류 500 + health `profile` 블록 | lib 2개 + index 개정 + 테스트 | 0 |
| 2 | **Worker 시트 접근 프로필화** — sheets/words sheetId 파라미터화, 전 라우트 프로필 스레딩, words 응답 `profile`, answer 모드 검증·졸업 판정 M화 | 라우트·lib 개정 + 테스트 | 1 |
| 3 | **클라이언트 학습 로직 M 파라미터화** — wordState·sessionQueue·homeStats 시그니처 확장 + 세 구성({m1}/{m2}/{m1,m2}) 테스트 | src/lib 개정 + 테스트 | 0 (2와 병렬 — 계약은 PRD로 이미 고정) |
| 4 | **클라이언트 프로필 컨텍스트** — api/wordsApi 프로필 수신·저장, Login/Home/App 배선, 프로필 이름 표기·전환 링크, 등록 링크 `zh` 전용 노출, design-prd §2·§3 개정(Q5 확정 포함) | 화면 개정 + 문서 | 2, 3 |
| 5 | **재시도 큐 프로필 태깅** — profileId 태깅·필터 flush·레거시 승격·4xx 폐기 | retryQueue 개정 + 테스트 | 4 |
| 6 | **`generic` 콘텐츠 렌더링 대응** — StudyScreen·Mode1/2Card의 zh/generic 분기(`lang`·크기·입력란 속성·칩 문구), B열 빈칸 숨김(공통), design-prd 해당 절 개정 | 화면 개정 + 문서 | 4 |
| 7 | **운영 전환·정리** — `PROFILES` 설정(1번 프로필 = 현 값), 새 프로필 시트 생성·서비스 계정 공유, 안정화 후 구 변수·폴백 제거 | 운영 체크리스트 실행 + 정리 PR | 5·6 |

의존 그래프: `0 → 1 → 2 → 4 → {5, 6} → 7`, `0 → 3 → 4`. 각 작업은 단독 배포 가능하게 자른다 — 1·2가 머지돼도 폴백 프로필로 기존 동작이 유지되고, 3은 M = {m1,m2} 고정 호출로 시작해 4에서 실제 modes가 연결되며, 6 전까지 `generic` 프로필은 (등록 링크만 없을 뿐) zh 스타일로 렌더링돼도 기능상 동작한다.

## 5. 마이그레이션·롤백

- **배포 순서 제약 없음**: 폴백(§PRD-general 3.2) 덕에 코드 먼저든 시크릿 먼저든 안전. Workers Builds(#67)가 머지 즉시 배포하는 환경에서 이 성질이 필수다.
- **권장 전환 순서**: ① 작업 1~5 머지(폴백으로 무변화 동작) → ② `PROFILES` 설정 — 1번 프로필에 현 `APP_PASSWORD`·`SHEET_ID`를 그대로 옮겨 기존 사용자 재로그인 불필요 → ③ 새 프로필 추가(시트 생성 → 서비스 계정 편집자 공유 → 시크릿 갱신) → ④ 안정화 후 작업 6(구 변수·폴백 제거).
- **롤백**: 구 코드는 `PROFILES`를 읽지 않으므로 코드 롤백만으로 v1 복귀. 시트 데이터는 계약 불변이라 영향 없음.
- **클라이언트 캐시**: 기존 사용자의 localStorage에는 비밀번호만 있고 프로필 캐시가 없다 — 다음 `/api/words` 응답에서 자연 충전되므로 마이그레이션 코드 불필요. 재시도 큐의 무태그 항목은 현재 프로필로 승격(§3.2 retryQueue).

## 6. 테스트 전략

- **기준선**: 기존 vitest 스위트가 M = {m1,m2} 경로로 그대로 통과해야 한다 (동작 보존 증명). 시그니처 변경으로 인한 테스트 수정은 modes 인자 추가에 국한.
- **profiles.ts**: 정상 파싱 / JSON 깨짐 / password·id 중복 / modes 빈 배열·잘못된 값 / 폴백 합성 / 캐시.
- **auth**: 프로필별 비밀번호 → 해당 프로필 해석, 전 불일치 401, 설정 오류 500 (worker/index.test.ts 통합 케이스).
- **학습 로직**: {m1} / {m2} / {m1,m2} 세 구성 × 상태 판정·큐 모드 선택·졸업 전이. 특히 단일 모드 졸업(D≥3만으로 F열 기록)과 §4.3 재해석 엣지(축소 후 F 빈칸 → 복습 대기).
- **answer 라우트**: 비활성 모드 400, M 기준 졸업 시 F열 `내일|1`, 프로필 sheetId로 호출됐는지 (mock fetch의 URL 검증).
- **retryQueue**: 프로필 필터 flush·타 프로필 보존·무태그 승격·4xx 폐기 후 계속·5xx/네트워크 중단.
- **격리 검증**: 프로필 A 비밀번호로 온 요청이 B의 sheetId에 닿는 경로가 없는지 — sheets 모듈에서 sheetId가 항상 명시 인자라는 타입 강제 + 통합 테스트로 확인.
- **콘텐츠 분기**: `generic` 프로필에서 등록 링크 비노출, B열 빈칸 행의 보조 표기 줄 숨김(zh·generic 공통), `zh` 전용 속성(`lang`·placeholder)이 generic에 새지 않는지.

## 7. 질문 해소 현황 (2026-07-21 소유자 확인 — PRD-general §10이 원본)

- **Q1 (시트 단위)**: **별도 스프레드시트 확정** → 작업 1·2 설계 그대로 착수 가능.
- **Q2 (구성 저장 위치)**: **`PROFILES` 시크릿 확정** → 설정 로더 불필요.
- **Q3 (졸업 조건)**: **활성 모드만 3회 확정** → 임계값 구성 필드 없음.
- **Q4 (비중국어 콘텐츠)**: **계획 있음** → `contentType` 필드(작업 1)·등록 링크 zh 전용(작업 4)·렌더링 분기(작업 6)로 이번 범위에 편입. **등록 화면의 콘텐츠 일반화는 별도 후속 플랜** (등록 검증·추출 킷·B열 검증 규칙까지 번지는 독립 주제 — 이 플랜의 비범위).
- **Q5 (홈 프로필 표기 디테일)**: 유일한 잔여 미결(경미) — 작업 4의 design-prd 개정에서 확정.

## 8. 결정 로그

| 항목 | 결정 | 기각한 대안 |
|---|---|---|
| 프로필 해석 위치 | 인증 미들웨어에서 1회 해석 후 핸들러에 명시 전달 | 핸들러별 재해석(중복·누락 위험), 전역 컨텍스트(테스트성 저하) |
| sheets.ts 개정 방식 | `sheetId` 명시 파라미터 | env 변조(`{...env, SHEET_ID}` 재주입 — 타입 거짓말·격리 검증 불가), 프로필 바인딩 클래스(현 규모에 과함) |
| 학습 로직 전달 방식 | `modes` 인자 추가 (순수 함수 유지) | 모듈 전역 설정(테스트 오염), React 컨텍스트(lib가 React 비의존인 현 구조 훼손) |
| 클라이언트 modes 원천 | words 응답의 `profile` (홈 진입마다 갱신) | localStorage 캐시만(구성 변경 미반영), 전용 프로필 API(왕복 추가) |
| 작업 3을 2와 병렬 | 채택 — 계약(PRD-general §4)이 먼저 고정되므로 | 직렬(불필요한 대기) |
| 재시도 큐 개정을 별도 작업(5)으로 분리 | 채택 — 실패 분류(4xx/5xx) 변경은 검증 포인트가 달라 독립 리뷰가 낫다 | 작업 4에 합침 |
| 등록 화면 내부 | 이번 범위에서 불변 — 진입 링크만 `contentType: "zh"` 전용 (Q4 소유자 확인 반영) | 전 프로필 노출 유지(비중국어 시트에서 무용지물), 검증 일반화(후속 플랜으로 분리) |
| `generic` 렌더링 대응을 별도 작업(6)으로 분리 | 채택 — 4까지만으로도 프로필 기능이 완결되고, 표시 품질은 독립적으로 다듬는 게 배포 단위가 깔끔 | 작업 4에 합침(리뷰 비대) |
