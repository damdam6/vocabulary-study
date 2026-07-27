# 등록 일반화 플랜 — `generic` 프로필 단어 등록

> 범용화 PRD(`docs/PRD-general.md` §10 Q4)가 "후속 플랜"으로 분리한 **등록 화면의 콘텐츠 일반화**를 정의한다. v1 등록 파이프라인의 원본은 `docs/plans/word-registration-system.md`(zh 전제)이고, 이 문서는 그 위에 contentType 분기를 얹어 `generic` 프로필에도 사이트 안 등록 경로를 여는 **변경분만** 다룬다. 여기 언급이 없는 사항은 두 원본 문서가 그대로 유효하다.
>
> 작성일: 2026-07-27 · 상태: **확정** — 같은 날 소유자 확인으로 §8 Q1~Q6 전부 해소 (Q5·Q6은 기본값 뒤집힘). **코드 착수 가능.** 작업 분해·그래프는 §5.

---

## 1. 배경·목표

- 범용화 구현(#70~#81)으로 프로필별 시트·모드·콘텐츠 타입 분리는 끝났지만, **단어 등록만 zh 전용**으로 남았다: 홈 진입 링크가 `contentType === "zh"` 조건부(#78)이고, 파이프라인 전 단계(추출 킷 → 클라 검증 → Worker 재검증)가 한자 유니코드 범위·병음 성조를 전제한다. `generic` 프로필의 단어 추가 공식 경로는 "구글 시트 직접 편집"(PRD-general §7)인데, 폰 주 사용 흐름(캡처 → 추출 채팅 → 붙여넣기 등록)이 generic에는 없는 셈이다.
- 짚고 갈 사실: **새 시트라도 zh 프로필이면 등록은 이미 동작한다** — 등록 라우트는 프로필 스레딩(#73)이 끝나 인증된 프로필의 `sheetId`에 쓴다. 공백은 오직 `generic` 프로필이다.
- 목표: 3단계 구조(추출 킷 → 등록 화면 → Worker 재검증, word-registration-system §2)와 신뢰 경계(1단계 출력 불신뢰 — 2·3단계 각각 재검증), 시트 계약(append-only · A~C열만 · D열 이후 불가침 · 탭 규칙)을 그대로 유지한 채 **검증·표시를 contentType으로 분기**한다. zh 경로는 동작 불변이어야 한다 — 기존 등록 테스트가 그대로 통과하는 것이 그 증명.
- 비목표: 언어별 사전 검증(영어 철자 검사 등 — pinyin-pro에 상응하는 generic 검증은 없다, 형식 검증만), 등록 화면 구조·플로우 변경, 시트 계약 변경, 단어 편집·삭제 UI, zh 스키마 변경.

## 2. 현황 — 파이프라인의 zh 결합 지점

| 단계 | 위치 | zh 결합 내용 |
|---|---|---|
| 스키마 | word-registration-system §3 | `{version:1, words:[{hanzi,pinyin,meaning}]}` — 필드명·한자 범위·성조 부호가 스키마 자체 |
| 추출 킷 | `docs/registration-kit/` | 프롬프트가 "Chinese Vocabulary Extractor", `schema_check.py`가 한자·병음 검사 |
| 클라 검증 | `src/lib/registerValidation.ts` | `HANZI_RE`, 병음 필수, pinyin-pro 일치 검사(`pinyinValidation.ts`), 사유 문구 "한자/병음" |
| 화면 | `RegisterScreen.tsx` · `RegisterTable.tsx` | placeholder zh 예시, 테이블 헤더 한자/병음/뜻, `lang="zh-Hans"` |
| Worker 재검증 | `worker/lib/register.ts` | `parseRegisterWords`가 한자 범위 + 성조 형식 강제, 라우트 400 문구 zh 전제 |
| 노출 | `HomeScreen.tsx` | "단어 등록 ›" 링크가 zh 프로필 조건부(#78) |

콘텐츠 중립으로 이미 끝난 것: 라우트의 프로필 스레딩(#73 — `profile.sheetId`), 탭 규칙·중복 스킵·append 범위·100건 한도, `GET /api/tabs`, `registerApi.ts` 와이어 클라이언트.

## 3. 설계

### 3.1 generic 붙여넣기 스키마

```json
{
  "version": 1,
  "contentType": "generic",
  "words": [
    { "term": "take off", "note": "구동사", "meaning": "이륙하다, (옷을) 벗다" },
    { "term": "run into", "meaning": "우연히 만나다" }
  ]
}
```

- `term` → A열(표제어, 탭 내 유일 키): 비공백 자유 텍스트(공백·문장부호 허용), 배치 내 중복 금지. `note` → B열(보조 표기): **선택** — 생략 또는 빈 문자열이면 B열 빈칸(학습 화면의 B열 빈칸 숨김(#92)과 정합). `meaning` → C열(뜻): 비공백, 한국어 권장(강제 검증 없음).
- **`contentType: "generic"` 자기서술 필드 필수.** zh 스키마는 불변(필드 없음 = zh — 기존 킷 출력 하위 호환). 등록 화면이 이 필드를 프로필 contentType과 대조해, 킷 출력을 다른 프로필에 붙여넣는 실수를 정확한 문구로 차단한다(§3.2).
- 스키마 원본 분담: zh = word-registration-system §3(불변), generic = **이 절**. `schema_check.py` · 클라 · Worker 구현은 각자 원본 참조 주석을 남긴다(기존 drift 방지 관행, #57).

### 3.2 검증 규칙 (신뢰 경계 유지 — 클라·Worker 각각)

| 검사 | zh (불변) | generic (신규) |
|---|---|---|
| A열 | 한자 기본 블록(U+4E00–9FFF), 비공백 | 비공백 자유 텍스트 (범위 제한 없음 — 한자 포함 무엇이든) |
| B열 | 병음 필수 + 성조 부호 형식 + pinyin-pro 일치(클라만) | 선택 (자유 텍스트, 빈칸 허용) |
| C열 | 비공백 | 비공백 |
| 공통 | 트림, 배치 내 A열 중복 금지, 100건 한도, 탭 규칙, 시트 내 중복은 스킵(정확 일치) | 동일 |

- **스키마 오배치 감지(클라)**: `generic` 프로필에 `contentType` 없는 JSON(또는 `hanzi` 필드 스키마) → "중국어(zh) 스키마로 보입니다 — 이 프로필은 generic 스키마(term/note/meaning)를 사용합니다" 류의 명시 오류. 역방향(zh 프로필에 `contentType:"generic"`)도 동일하게 차단. Worker는 형태 검증만으로도 자연 차단된다(심층 방어).
- 시트 내 중복 판정은 현행 그대로 **A열 정확 일치** — 대소문자·공백 변형은 다른 표제어로 취급한다(§8 Q4).

### 3.3 와이어 계약 — `POST /api/words/register` 단일 형태 유지

- 요청 `words[]`는 contentType과 무관하게 **`hanzi`/`pinyin`/`meaning` 필드명을 A/B/C열 운반자로 유지**한다. 근거: `GET /api/words`·`POST /api/answer`·`review-fail`·재시도 큐가 이미 generic 프로필에서도 `hanzi`를 "A열 값" 의미로 쓴다(범용화는 필드명이 아니라 의미를 일반화했다 — PRD-general §2 "표제어"). 등록만 중립 필드명을 쓰면 API 안에서 계약이 갈라진다.
- 중립 필드명(`term`/`note`)은 **사용자 대면 계층(붙여넣기 스키마·킷·화면 라벨)에만** 존재하고, 클라이언트 파서 진입점 한 곳에서 `term→hanzi, note→pinyin`으로 매핑한다. 내부 표현(`ValidatedRow` 등)도 운반자 필드명을 유지해 화면·API 코드 개정을 최소화한다.
- Worker 검증은 `profile.contentType`으로 분기: generic이면 `pinyin`은 문자열이기만 하면 되고(빈 문자열 허용 → B열 빈칸), `hanzi` 범위·성조 검사를 적용하지 않는다. 응답 형태(`{tab, created, added, skipped}`)·400 오류 형태 불변, 문구만 contentType별로 정확하게.
- **탭 0개 부트스트랩(§8 Q6)**: 학습 대상 탭이 하나도 없는 스프레드시트에 `createTab`으로 등록하면, 기존 400("헤더를 복사할 기존 탭이 없습니다") 대신 **contentType별 기본 헤더로 첫 탭을 생성**한다 — zh `한자|병음|뜻|모드1|모드2|복습`, generic `표제어|보조 표기|뜻|모드1|모드2|복습` (기존 테스트 픽스처 관례의 번안, A~F만 — G열 이후는 타임스탬프 append 영역이라 헤더 없음). 헤더 행은 표시용일 뿐이라(전 탭 1행 스킵) 파싱에 영향이 없다. 탭이 1개 이상이면 현행(첫 탭 헤더 복사) 유지, `createTab` 없는 미존재 탭 400도 유지. zh 프로필의 새 스프레드시트 온보딩도 같이 좋아진다.

### 3.4 화면

- **홈**: "단어 등록 ›" 링크의 zh 조건 제거 → **전 프로필 노출** (#78 조건 뒤집기, design-prd §3 개정).
- **등록 화면**: `App.tsx`가 StudyScreen과 같은 패턴(`getStoredProfile()?.contentType ?? 'zh'`)으로 contentType을 내려준다. 분기 지점 — placeholder 예시 JSON, 검증 사유 문구, RegisterTable 헤더(한자/병음/뜻 ↔ 표제어/보조 표기/뜻)와 A열 `lang="zh-Hans"`(zh 전용). 플로우(확인 게이트 #55 · 중복 확인 배너 · 제출 대상 valid+duplicate)는 불변.
- pinyin-pro는 zh 경로 전용으로 유지 — generic 검증 경로가 사전을 참조하지 않게 한다(등록 화면 자체가 이미 지연 청크라 번들 분리는 선택 사항).

### 3.5 추출 킷

- **언어별 프롬프트(§8 Q5)** — 범용 1종이 아니라 언어마다 전용 프롬프트를 둔다. 이번 범위는 실수요인 **영어 킷 1종**: `docs/registration-kit/en-extraction-prompt.md` **신규** (영문 프롬프트) — 캡처·깨진 텍스트에서 영어 단어·표현·숙어를 추출해 §3.1 스키마 JSON 한 블록으로 출력. `note`는 원문에 근거 있을 때만(발음기호·품사 등), `meaning`은 한국어 간결. zh 킷과 마찬가지로 시트·자격증명 무지 원칙, 출력 전 `schema_check.py` 자체 검증 지시. 다른 언어 시트가 생기면 같은 패턴으로 `{lang}-extraction-prompt.md`를 추가한다.
- `schema_check.py`는 **한 파일이 두 스키마 겸용** — `contentType` 필드로 판별(없으면 zh). 스키마가 콘텐츠 중립(term/note/meaning)이라 검증기는 언어와 무관하다 — 언어별 분리는 프롬프트 층에만 적용된다. 모든 claude.ai 프로젝트(중국어/영어/이후 언어)에 같은 파일을 올려 운영 단순화. 기존 zh 프롬프트(`extraction-prompt.md`)는 내용 불변, 헤더 주석에 sibling 포인터만.

## 4. 영향 범위 (파일 단위)

| 파일 | 변경 |
|---|---|
| `worker/lib/register.ts` | `parseRegisterWords(raw, contentType)` — generic 분기(§3.2·§3.3) + contentType별 기본 헤더 상수(§3.3 부트스트랩). zh 규칙 코드 불변 |
| `worker/routes/register.ts` | `profile.contentType` 전달 + 400 문구 분기 + 탭 0개 부트스트랩("헤더 복사할 탭 없음" 400 제거) |
| `src/lib/registerValidation.ts` | generic 스키마 파서(term/note/meaning → 운반자 매핑) + 스키마 오배치 감지 + 사유 문구 분기. `validateRegistrationInput`에 contentType 파라미터 |
| `src/screens/RegisterScreen.tsx` · `RegisterTable.tsx` | contentType prop — placeholder·라벨·헤더·`lang` 분기 |
| `src/App.tsx` | RegisterScreen에 contentType 전달 (StudyScreen 패턴) |
| `src/screens/HomeScreen.tsx` | 등록 링크 zh 조건 제거 |
| `src/lib/pinyinValidation.ts` · `registerApi.ts` | **불변** (zh 전용 유지 · 와이어 단일 형태) |
| `docs/registration-kit/` | `en-extraction-prompt.md` 신규(영어 킷 — 언어별 패턴의 첫 사례), `schema_check.py` 겸용 확장, `extraction-prompt.md` 헤더 포인터 |
| `docs/PRD-general.md` | §5.2 "register 계약 불변" 문구, §7 단어 등록 불릿, §10 Q4 결론에 개정 노트 (2026-07-27, 이 플랜 포인터) |
| `docs/plans/word-registration-system.md` | 머리에 generic 분담 포인터 (§3은 zh 원본으로 불변) |
| `docs/design-prd.md` | §3 홈(링크 조건 제거) · §6 등록 화면(generic 라벨·placeholder) 개정 |
| `docs/PRD.md` | **불변** — v1 원본. 범용화 차원 변경분은 PRD-general이 담당하는 기존 위계 유지 |

## 5. 작업 분해 (이슈 후보)

| # | 내용 | 산출물 | 의존 |
|---|---|---|---|
| 0 | ~~**플랜 확정**~~ — **완료** (2026-07-27 소유자 확인 Q1~Q6, §8). 남은 것: 이 문서 main 커밋 | 이 문서 확정 | — |
| A | **킷·문서** — 영어 추출 킷 `en-extraction-prompt.md` 신규 + `schema_check.py` 두 스키마 겸용 + `extraction-prompt.md` 포인터 + PRD-general §5.2·§7·§10 Q4 개정 + word-registration-system 머리 포인터 | 킷 2건 + 문서 3건 | 0 |
| B | **Worker generic 검증·부트스트랩** — `parseRegisterWords` contentType 파라미터화(§3.2·§3.3) + 라우트 전달·문구 분기 + 탭 0개 기본 헤더 부트스트랩 + 테스트 | worker 2파일 + 테스트 | 0 (A·C와 병렬) |
| C | **등록 화면 generic 대응** — registerValidation generic 파서·오배치 감지 + RegisterScreen/RegisterTable/App 분기 + 테스트 | src 5파일 + 테스트 | 0 (B와 병렬) |
| D | **등록 링크 전 프로필 노출** — HomeScreen zh 조건 제거 + design-prd §3·§6 개정 | 화면 + 문서 | B, C |

- 의존 그래프: `0 → {A, B, C}`, `{B, C} → D`. **D가 마지막 스위치다** — 링크가 열리기 전에 Worker(B)와 화면(C)이 generic을 처리할 수 있어야 하므로, D 전까지는 어떤 머지도 사용자 가시 변화가 없다(배포 단위 안전). A는 코드와 독립이라 언제 머지돼도 무방하다.
- B·C가 병렬 가능한 이유: 와이어 계약(§3.3)과 붙여넣기 스키마(§3.1)가 이 플랜으로 먼저 고정되기 때문 (service-generalization 작업 2·3 병렬과 같은 논리).

### /issue-graph 등록 블록 (작업 0 완료 후, 오케스트레이터 탭에서)

```
/issue-graph
A(등록 일반화 — 영어 추출 킷·문서 개정: docs/plans/registration-generalization.md §5 작업 A. en-extraction-prompt.md 신규(언어별 킷 패턴의 첫 사례), schema_check.py 두 스키마 겸용, extraction-prompt.md 포인터, PRD-general §5.2·§7·§10 Q4 및 word-registration-system 포인터 개정)
B(등록 일반화 — Worker generic 검증·부트스트랩: docs/plans/registration-generalization.md §5 작업 B. parseRegisterWords contentType 파라미터화 — generic은 A열 자유 텍스트·B열 빈칸 허용, 라우트에서 profile.contentType 전달·400 문구 분기, 탭 0개 스프레드시트는 contentType별 기본 헤더로 첫 탭 부트스트랩, zh 경로 불변 + 테스트)
C(등록 일반화 — 등록 화면 generic 대응: docs/plans/registration-generalization.md §5 작업 C. registerValidation에 generic 스키마(term/note/meaning) 파서·스키마 오배치 감지·운반자 매핑, RegisterScreen·RegisterTable·App contentType 분기, pinyin-pro zh 전용 유지 + 테스트)
B·C → D(등록 일반화 — 등록 링크 전 프로필 노출: docs/plans/registration-generalization.md §5 작업 D. HomeScreen 등록 링크 zh 조건 제거, design-prd §3·§6 개정)
```

실행 절차: ① 이 문서 main 커밋(작업 0 잔여) → ② 위 블록을 `/issue-graph`에 붙여넣어 그래프 등록 → ③ 루트(A·B·C) kickoff 승인 — 이후는 issue-review가 각 이슈를 plan → work → PR → merge로 끌고 가며 `/issue-continue` 콜백으로 그래프가 자동 전진, B·C 머지 시 D가 자동 착수된다.

## 6. 테스트 전략

- **zh 회귀 기준선**: 기존 등록 테스트 3벌(`worker/lib/register.test.ts` · `worker/routes/register.test.ts` · `src/lib/registerValidation.test.ts`)이 무수정 통과(contentType 파라미터 기본값/명시 인자 추가만 허용) — zh 동작 보존 증명.
- **Worker generic**: B열 빈칸 허용, A열 자유 텍스트(공백·문장부호·한자 혼입), zh 규칙(범위·성조)이 generic에 적용되지 않는지·역도, 배치 내 A열 중복 400, 100건 한도, generic 프로필로 스킵·append 범위(A:C) 불변.
- **Worker 부트스트랩**: 탭 0개 + `createTab` → contentType별 기본 헤더(A~F)로 생성 후 2행부터 등록, `createTab` 없으면 여전히 400, 탭 1개 이상이면 현행(첫 탭 헤더 복사) 유지.
- **클라 generic**: note 생략/빈 문자열, term 중복 차단, 오배치 감지 양방향(zh JSON→generic 프로필, generic JSON→zh 프로필), 운반자 매핑 정확성.
- **화면**: 테이블 헤더·placeholder 분기, `lang="zh-Hans"`가 generic에 새지 않는지, 홈 링크 전 프로필 노출.
- **격리**: generic 등록이 인증 프로필의 sheetId로만 쓰는지 (기존 mock URL 검증 패턴 재사용).

## 7. 운영·롤백

- **킷 프로젝트**: claude.ai에 영어용 프로젝트 신설(`en-extraction-prompt.md` + `schema_check.py` 업로드). 기존 중국어 프로젝트는 `schema_check.py`만 갱신본으로 교체. 이후 언어 추가 시 프롬프트 파일·프로젝트만 늘린다.
- **새 스프레드시트 온보딩**: 탭 0개여도 첫 등록이 기본 헤더 부트스트랩(§3.3)으로 동작하므로 사전 준비가 필요 없다. 단, 새 문서의 기본 "Sheet1" 탭은 학습 대상으로 집계되고 헤더 복사 원본이 된다(1행이 비어 있으면 빈 헤더가 복사됨) — 쓰지 않을 기본 탭은 삭제하거나 `_` 접두로 이름을 바꿔 두기를 권장한다(#81 절차와 같은 맥락).
- **배포 순서**: 그래프 의존이 곧 배포 순서다(§5 — D가 마지막). 각 작업 단독 머지 안전.
- **롤백**: 변경이 전부 가산적(zh 경로 불변)이라 개별 PR revert로 충분. 시트 데이터 영향 없음(계약 불변).
- **스모크**: D 머지 후 generic 프로필에서 실기기 1건 등록 → 해당 시트 A~C열 반영·D열 이후 무접촉 확인.

## 8. 질문 해소 현황 (2026-07-27 소유자 확인 — 잔여 미결 없음)

| # | 질문 | 결론 |
|---|---|---|
| Q1 | generic 붙여넣기 스키마 형태 | **중립 필드명(`term`/`note`/`meaning`) + `contentType` 자기서술 필수** — 기본값 확정 (§3.1) |
| Q2 | 와이어·내부 표현 필드명 | **`hanzi`/`pinyin` 운반자 단일 형태 유지** — 기본값 확정 (§3.3) |
| Q3 | generic 검증 수준 | **형식 검증만** — 기본값 확정, 사전류 검증 없음 (§3.2) |
| Q4 | 시트 내 중복 판정 | **A열 정확 일치 유지(대소문자 구분)** — 기본값 확정, 모드 2 채점과 같은 방침 (§3.2) |
| Q5 | 추출 킷 구성 | **언어별 킷 분리** (기본값 뒤집힘) — 이번 범위는 영어 킷 1종, 검증기(`schema_check.py`)는 스키마 담당이라 단일 겸용 유지 (§3.5) |
| Q6 | 탭 0개 스프레드시트의 첫 등록 | **contentType별 기본 헤더로 자동 생성** (기본값 뒤집힘) — 부트스트랩 §3.3, "헤더 복사할 탭 없음" 400 제거 |

## 9. 결정 로그 (Q1~Q6은 2026-07-27 소유자 확인 — §8이 원본)

| 항목 | 결정 | 기각한 대안 |
|---|---|---|
| 스키마 판별 | 프로필이 아니라 JSON의 `contentType` 자기서술 + 프로필 대조 | 프로필만으로 판별(오배치 시 "필드 비어 있음" 류 오독성 오류), version 2 부여(병렬 스키마를 버전 승계로 오독) |
| 붙여넣기 필드명 | 중립(`term`/`note`) — 사용자 대면 계층 한정 | `hanzi`에 영어 표현 담기(킷 채팅 혼란·수기 수정 함정), 전 계층 중립 개명(words·answer API와 불일치, 개정 폭주) |
| 와이어 형태 | 단일 유지 — 운반자 `hanzi`/`pinyin`/`meaning`, 매핑은 클라 파서 한 곳 | contentType별 와이어(Worker·클라 계약 2벌, RegisterResult 분기) |
| B열 규칙 | generic 선택(빈칸 허용) | 필수(영어 표현에 강제할 값이 없음 — PRD-general §3.3 "빈칸 허용"과 모순) |
| generic 검증 | 형식만 | 언어 감지·철자 검사(결정적이지 않고 오차단 위험, 비범위) |
| 등록 링크 | 전 프로필 노출 (PRD-general §7 결정 개정) | contentType별 설정 플래그(수요 없는 구성 축) |
| 추출 킷 (Q5, 소유자 확정) | 언어별 프롬프트 분리 — 이번엔 영어 1종, 스키마·검증기·화면은 공용 | 범용 프롬프트 1종(언어별 추출 지침이 희석됨), 킷 없이 화면만(폰 캡처 흐름 부재) |
| 첫 탭 부트스트랩 (Q6, 소유자 확정) | contentType별 기본 헤더로 자동 생성 — 문구는 기존 테스트 픽스처 관례(한자·병음·뜻·모드1·모드2·복습)의 번안, A~F만 | 현행 400 유지 + 운영 절차(온보딩 마찰), 헤더 없는 탭 생성(시트 가독성 저하) |
| schema_check 구성 | 단일 파일 겸용 — 스키마가 콘텐츠 중립이라 언어별 분리 대상이 아님 | 파일 2벌(두 프로젝트 운영·drift 부담) |
