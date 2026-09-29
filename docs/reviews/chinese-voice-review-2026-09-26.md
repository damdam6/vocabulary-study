# 중국어 음성 시스템 전체 검토 및 코드 리뷰

- 프로젝트: `chinese-voice-review`, 저장소 별칭: `voca-study` (`vocabulary-study`)
- 검토일: 2026-09-26 KST
- 기준: `607eea8007ec0fabd6fb3d3f7a78d17be9ae989f`, `chore/chinese-voice-review`
- 결과: **P2 코드 결함 2건, P3 운영 문서 불일치 1건**. 구현 변경 없이 리뷰와 재현 증거를 기록했다.
- P2는 특정 정상 사용/장애 경로에서 수정이 필요한 결함, P3는 운영 정확성·유지보수 문제다. 이번 검토에서 P0/P1은 확인하지 못했다.

## R1 — P2: 정답 공개 전 숨김·복귀 후 수동 발음이 재생되지 않는다

**위치:** `src/lib/speak.ts:313-315,335-346` 및 `src/hooks/usePronunciation.ts:107-114`. 관련 화면은 `src/screens/Mode1Card.tsx:91-96`, `src/screens/Mode2Card.tsx:58-65`.

**재현:** 중국어 모드1 앞면 또는 모드2 입력 화면에서 다른 탭으로 이동한 뒤 복귀한다. 정답을 공개하고 발음 버튼을 반복 클릭한다. 다운로드는 성공하지만 해당 문제의 음성이 재생되지 않는다. 플립 완료 전 숨김도 같은 상태에 도달할 수 있다.

**원인:** `stop('hidden')`이 `hiddenStopped=true`를 남긴다. 훅의 visible 분기는 UI 가드만 풀고 controller 상태를 바꾸지 않는다. 이어지는 `reveal()`은 `viewReady=true`를 설정하기 전에 반환한다. 수동 `replay()`는 hiddenStopped를 해제하고 Blob을 준비하지만 viewReady는 false여서 `startPlay()`가 반환한다. 카드의 reveal 전달 플래그는 이미 소비되므로 후속 클릭으로 회복되지 않는다.

**검증:** [재현 테스트](evidence/chinese-voice-review.test.ts.txt)의 R1은 `activate → hidden → prepare/reveal → replay → 응답 완료 → replay` 뒤 transport 1회, snapshot `ready`, Audio play **0회**를 확인했다. 기존 `speak.test.ts`의 hidden 테스트는 reveal **이후** 숨김이라 이 경로를 놓친다. 브라우저 청취 결과가 아닌 실제 controller 코드의 단위 재현이다.

**수정 방향:** 화면의 공개 상태 기록과 자동재생 허용 여부를 분리한다. visible 복귀 시 자동 요청·재생을 추가하지 않으면서 공개 사건을 controller가 기록하고, 공개된 화면의 수동 replay는 실행되게 해야 한다. 모드1 앞면/플립 중·모드2 입력 중 숨김을 각각 화면 통합 회귀에 추가한다.

## R2 — P2: R2 조회 타임아웃이 진행 중인 본문 읽기를 정리하지 않는다

**위치:** `worker/lib/tts/service.ts:105-111`, `worker/lib/tts/storage.ts:91-104,141-163`.

**재현:** R2 get이 메타데이터와 본문 스트림을 반환하지만 본문 read가 멈춘 상황에서 조회 deadline을 만료시킨다. 서비스는 저장소 오류로 종료하지만 body reader는 계속 잠겨 있고 cancel은 호출되지 않는다.

**원인:** 서비스는 `storage.get(key)` Promise를 시간 제한과 경쟁시킬 뿐 저장소에 signal/취소 수단을 전달하지 않는다. `readBoundedAudio()`는 `reader.read()`를 기다리고 있어서 서비스 바깥에서 발생한 timeout/abort를 알 수 없다. 내부 catch/finally도 실행되지 않는다. 메타데이터가 부적합한 객체를 조기 거부하는 분기 역시 body를 cancel하지 않는다.

**영향:** 응답 제한시간은 지키지만 불필요한 읽기와 수집한 chunk의 수명은 그 제한시간에 묶이지 않는다. 반복 장애/취소에서 자원 회수가 런타임 또는 스트림 종료에 의존한다. 운영 Worker의 실제 잔존 시간·메모리 증가량은 측정하지 않았으며 영구 누수나 OOM을 입증한 것은 아니다.

**검증:** R2 재현은 실제 `createR2TtsAudioService`와 `ReadableStream`, 제어 가능한 deadline을 연결했다. `tts_storage_unavailable` 이후 `cancel=0`, `body.locked=true`, provider 호출 0회를 확인했다. 이는 조회 실패 때 재합성하지 않는 정책은 지켜짐을 함께 보여준다. Workers의 reader 취소 API는 [공식 ReadableStreamDefaultReader 문서](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestreamdefaultreader/)에서 확인했다.

**수정 방향:** 조회 단계 전용 취소 신호를 저장소 body reader까지 전달하고 timeout/요청 취소 시 reader를 취소한다. 늦게 도착한 R2 객체와 메타데이터 조기 거부의 body도 정리한다. 의도적으로 `waitUntil`로 관찰하는 put 수명과는 구분한다.

## R3 — P3: 운영 런북의 활성화 상태가 현재 소스와 다르다

**위치:** `docs/plans/chinese-tts-audio-operations.md:5,22` 및 문서 마지막 문단 ↔ `wrangler.jsonc:26`.

런북은 현재 baseline을 `TTS_ENABLED=false`라고 안내하지만 소스는 `true`다. 2026-09-24 커밋 `f896daa54838a42ec9318b230f8ff9016e752777`은 명시적으로 운영 TTS 활성화를 기록하며 Wrangler 설정과 생성 타입을 바꿨다. 런북은 그보다 앞선 9월 17일 기준에 머문다.

**영향:** 이 런북을 현재 운영 기준으로 읽으면 새 배포가 비활성이라고 잘못 판단할 수 있고, 과거 출시 gate와 이후 검증 이력을 구별할 수 없다. `true` 자체를 결함으로 판단하거나 승인 없이 false로 되돌릴 근거는 없다.

**검증:** 현재 파일 및 `git log/show` 대조. 배포된 Worker의 실제 설정·secret·청취 완료 여부는 조회하지 않았으므로 소스 활성화와 운영 배포 성공을 동일시하지 않는다.

**수정 방향:** 9월 17일 내용을 과거 baseline으로 표시하고 활성화 커밋·배포 식별자·실환경 검증의 확인/미확인 상태를 별도 갱신한다.

## 전체 흐름과 확인 범위

| 단계 | 구현·확인 사항 | 증거 |
|---|---|---|
| capability | 인증 프로필이 zh이고 서버 설정이 ready일 때만 활성화. 구서버/잘못된 capability는 off | `worker/routes/words.ts`, `src/lib/wordsApi.ts`, 관련 테스트 |
| 정답 공개 | 모드1은 prepare 후 플립 완료 reveal, 모드2는 오답 DOM 반영 후 reveal. 정답은 합성하지 않음 | `Mode1Card`, `Mode2Card`, `StudyScreen.tts.integration.test.tsx` |
| 세션 수명 | StudyScreen의 controller/audio/cache 소유. 질문 세대 번호로 stale 응답 차단. 다음·종료·401에서 정리 | `usePronunciation.ts`, `speak.ts`, `ttsAudio.ts`, 화면 통합 테스트. 숨김 전 공개 누락은 R1 |
| 메모리 캐시 | profile/revision/text/pinyin 키, 20개·8MiB LRU 및 pin, Object URL은 Audio가 별도 소유 | `ttsBlobCache.ts`, `ttsAudio.ts`와 단위 테스트 |
| HTTP | 공통 apiFetch 인증·401 처리. 준비 20초, 응답 4MiB, 진단 header 조합 검사 | `ttsApi.ts`, `api.ts`, `ttsApi.test.ts` |
| 요청 경계 | 인증→zh→설정→JSON 검증. 16KiB, 한자 포함 1~200 code point, NFC/trim, 허용 필드 제한 | `worker/index.ts`, `routes/tts.ts`, `input.ts`, route/input 테스트 |
| 합성 내용 | A열 원문만 provider에 전달. 병음은 absent/ignored이며 저장 키에는 포함 | `pronunciation.ts`, `qwenProtocol.ts`, 문장 통합 테스트. 병음 강제 미적용은 합의된 정책 |
| R2 | profile+sheet 및 설정·원문 해시 키, MP3 검증, 조회 실패 시 합성 없음, 조건부 put 및 경합 재조회 | `storage.ts`, `service.ts`, storage/service 테스트. 조회 정리는 R2 |
| Qwen | 고정 국제 endpoint, 인증 Upgrade, task-started→continue/finish, 문장 메타데이터+바이너리, task-finished 후 성공 | `providers/qwen.ts`, `qwenProtocol.ts`, provider 테스트 |
| 예산·실패 | 조회 2초·합성 12초·저장 2초. 합성 abort와 socket 정리, 저장 실패는 UNCONFIRMED, put 관측은 waitUntil | `service.ts`, `routes/tts.ts`, 서비스 통합 테스트 |
| 학습 독립성 | TTS 실패가 채점·진행·통계·answer/review retryQueue를 바꾸지 않음 | `StudyScreen.tts.integration.test.tsx`, `ttsServerClient.integration.test.ts` |
| 운영·관측 | enabled=true, R2 binding, 로그 활성화. 성공/저장 로그가 있고 traces는 명시 설정 없음 | `wrangler.jsonc`, `routes/tts.ts`, `service.ts`, 운영 문서 |

제공자 프로토콜은 현재 [Qwen 공식 서버 이벤트 문서](https://docs.qwencloud.com/api-reference/speech-synthesis/cosyvoice/server-events)와 대조했다. sentence-synthesis 뒤 바이너리 1개를 받는 순서 및 usage의 누적 문자 수 처리는 문서와 부합한다. 이는 실제 계정의 모델 접근·음질·과금 검증을 대체하지 않는다. R2 조건부 put 계약은 [공식 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)와 대조했다.

## 검증 결과와 한계

- 기존 전체: `npm test -- --configLoader runner` → **59 files / 1128 tests passed**, 2026-09-26, 약 3.17초.
- 결함 재현: `npm test -- --configLoader runner docs/reviews/evidence/chinese-voice-review.test.ts` → **1 file / 2 tests passed**. 이 테스트의 통과는 결함 재현 성공이며 수정 완료가 아니다. 수정할 때 정상 동작 assertion으로 전환해야 한다.
- 추가 증거 파일만 Oxlint 실행 → 경고·오류 0.
- 로그: [기존 테스트](evidence/baseline.txt), [재현 테스트](evidence/reproduction.txt).
- 기존 main checkout의 node_modules를 링크해 사용했다. Node 24.11.0, Vitest 4.1.10. lockfile 기준 새 설치는 하지 않았다. 첫 기본 config loader 실행은 공유 node_modules의 `.vite-temp` 쓰기 권한 오류였고 runner loader로 실행했다.
- 코드·설정 변경이 없는 리뷰이므로 build/typecheck는 실행하지 않았다. 유료 합성, secret 조회, 배포, 실제 R2 접근, 모바일 청취·자동재생, 실측 p95는 수행하지 않았다.
- Workers 검사는 Node 기반 mock 테스트다. 실제 workerd의 R2/WebSocket/클라이언트 취소 전파는 별도 검증이 필요하다.
- 관측 보완 후보: traces 미설정 및 합성/조회 오류의 상세 내부 계측 부족. 장애별 지연과 실제 비용 영향은 이 리뷰만으로 확정하지 않는다.

## 보드 기록

보드 등록·색상 `#272DA2` 생성 완료. 공통 ctx에 기존 PRD와 아키텍처 2개를 연결하고 경로 누락 0을 확인했다. watcher.start 요청을 전송했다. 작업 목록은 비어 있으며 이 리뷰는 보드 조사 기록이다. 수정 태스크 등록·착수 또는 프로젝트 완료 처리는 하지 않았다. 저장된 커밋 정책은 `needs-confirmation`이므로 후속 커밋 전에 형식을 확정해야 한다.

## 후속 수정·병합 결과

2026-09-26에 세 지적 사항의 후속 태스크를 프로젝트 브랜치 `chore/chinese-voice-review`에 통합했다. 위 본문은 기준 커밋에서 수행한 최초 리뷰의 역사적 기록이다.

| 지적 | 태스크 | 병합 커밋 |
|---|---|---|
| R1 | `tts-hidden-replay` | `3b893f8fd2842fe7d4ce9c0568ad569d8b4327c9` |
| R2 | `tts-r2-read-lifetime` | `2563eab16e6e2c2bced1b0787df0c692ab3f387c` |
| R3 | `tts-activation-doc-drift` | `ce47347a34d554acba4c75e3002a2775d91f14fd` |

R1은 Grok code/react, R2는 Grok code/typescript, R3는 Grok code 리뷰에서 지적 0건으로 처리됐다. 작업 세션 기록에서 R1 전체 1,133 tests 및 lint/build, R2 관련 54 tests 및 lint/build 통과를 확인했다. 실제 운영 합성·R2·모바일 청취의 미검증 경계는 그대로 남는다.

원본 재현 코드는 당시 결함이 존재해야 통과하는 역사적 증거이므로 `.test.ts.txt`로 보존해 현재 Vitest 자동 수집에서 제외한다. 위 재현 명령과 로그는 최초 검토 당시의 경로·실행 기록이다. 수정 후 정상 동작 회귀는 `src/lib/speak.test.ts`, `src/screens/StudyScreen.tts.integration.test.tsx`, `worker/lib/tts/service.test.ts`, `worker/lib/tts/storage.test.ts`에 포함돼 있다.
