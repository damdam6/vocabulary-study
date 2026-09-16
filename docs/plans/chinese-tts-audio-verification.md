# 중국어 TTS 자동 검증 기록 (#150)

## 범위와 증거 기준

- 브랜치: `feat/150-chinese-audio-integration-tests` (base: `feat/ch-sound`)
- 외부 더블은 R2 bucket, Qwen Upgrade/WebSocket, HTTP, native Audio/Object URL, 시간뿐이다. Worker route/service/storage/Qwen adapter와 클라이언트 `fetchTtsAudio`/controller/Blob cache/audio output은 실제 구현을 사용한다.
- 운영 기본값 `TTS_ENABLED=false`는 바꾸지 않았다. 격리 fixture에서만 true를 썼으며 실제 키·R2·유료 합성·배포는 호출하지 않았다.

## #150 대표 통합 증거

| 식별자 | 실제 자동 테스트 제목 | 실행한 핵심 단언 | 자동화 밖 한계 |
| --- | --- | --- | --- |
| S1/S3 | `src/screens/ttsServerClient.integration.test.ts` — `S1은 새 controller/cache가 저장 바이트를 재생하고 S3 UNCONFIRMED는 fetch 없이 replay한다` | 첫 클라이언트가 route의 생성 MP3를 Audio로 재생하고 R2에 저장한다. 새 controller/cache는 저장된 동일 바이트를 재생하며 put은 1회다. write 실패 `UNCONFIRMED`도 Audio 재생 후 같은 수명 replay에서 route fetch를 더 만들지 않는다. | 실제 R2의 기기·지역 간 지속성, 쓰기 deadline은 운영 검증이다. |
| S2 | `worker/tts.integration.test.ts` — `S2/S3: 조회 장애는 합성하지 않고, 쓰기 장애는 생성 MP3를 UNCONFIRMED로 반환한다` | 조회 reject는 합성 없이 storage 오류가 되고, put reject는 `UNCONFIRMED` MP3 응답이 된다. | 실제 R2 권한·장애 계측은 운영 검증이다. |
| S4 | `worker/tts.integration.test.ts` — `S4: provider 인증 실패는 앱 인증 401과 분리되고, 앱 401은 R2/provider 전에 종료된다` | 제공자 인증 실패와 앱 401의 상태/선행 호출을 분리한다. | 배포 로그인 UX는 별도 확인이다. |
| C1 | `src/screens/StudyScreen.tts.integration.test.tsx` — `C1: StrictMode 모드1은 공개 완료 뒤 실제 transport/controller/audio를 한 번만 연결하고 빠른 판정 뒤 늦은 완료를 막는다`, `C1: 준비 중 판정 또는 실제 unmount 뒤 늦은 TTS 응답은 재생하지 않는다` | 실제 StudyScreen 훅 경로에서 공개 뒤 play 1회, 빠른 판정/언마운트 뒤 늦은 응답 play 0회를 확인한다. | 실제 브라우저 정책은 별도 확인이다. |
| C2/C5 | `src/screens/StudyScreen.tts.integration.test.tsx` — `C2/C5: 모드2 일반·빈 오답만 정답 표제어를 요청하며 정답·off는 기존 학습 진행을 막지 않는다`, `C5: B열 병음이 비어도 모드1 공개 뒤 A열만으로 실제 Audio를 재생한다` | 일반/빈 오답은 A열 요청 1회씩, 정답/off는 기존 진행을 유지한다. 빈 B열은 `{text}`만 보내 Audio play까지 도달한다. | 실제 음질은 별도 청취 검증이다. |
| C3/C4 | `src/screens/StudyScreen.tts.integration.test.tsx` — `C3: hidden은 실제 Audio URL을 정리하고 visible 복귀는 자동 요청·재생 없이 수동 replay만 허용한다`, `C4: 실제 App/Home/Study 경계에서 provider 503은 로그인 상태를 보존하고 앱 401은 활성 Audio와 URL을 정리한다` | hidden 및 App 401에서 pause/revoke를, visible에서 자동 fetch/play 0회와 수동 cache replay를 확인한다. | 모바일 background/foreground는 실기기 검증이다. |
| C6/C7 | `src/screens/StudyScreen.tts.integration.test.tsx` — `C6: 혼합 4문제 transcript는 TTS success/failure/off에서도 진행·기록·통계를 보존한다`, `C6: 혼합 transcript의 기록 5xx는 TTS와 무관하게 실제 retryQueue에 answer/review를 보존한다`, `C7: 실제 App success callback은 TTS 200 뒤 기존 answer retry를 flush하고 TTS 자체는 queue에 넣지 않는다` | 네 문제의 progress, review 대기, `{correct:2, wrong:2}`, q1/q4 answer·q3 review-fail 및 5xx localStorage queue를 TTS success/503/off에서 확인한다. | 실제 Sheets 전송은 운영 검증이다. |

## PRD §8 AC-01~24 추적

각 행의 요구 문구는 `docs/PRD-chinese-tts-audio.md` §8에서 대조했다. 아래의 제목은 모두 해당 소스에 실제로 존재하며, 요약한 assertion만 인용한다.

| AC | PRD 요구 | 실제 자동 증거와 assertion | 외부/잔여 한계 |
| --- | --- | --- | --- |
| AC-01 | generic 학습은 버튼·요청·재생 0, 직접 API 거부 | `Mode1Card.test.tsx` — `generic/off에서는 버튼과 발음 호출이 없고 기존 판정 focus fallback을 유지한다`; `worker/routes/tts.test.ts` — `미인증은 빈 401과 no-store로 끝나며 R2/provider를 호출하지 않는다` | 배포 capability 조합 확인 |
| AC-02 | 모드1 플립 전 0, 종료 후 자동 1회 | C1 StrictMode 제목; transition 전/후 request와 play 1회 | 실기기 청취 |
| AC-03 | 재렌더·중복 transition의 중복 방지 | C1 StrictMode 제목; 늦은 두 번째 transition 뒤 play가 늘지 않음 | 브라우저별 transition 이벤트 |
| AC-04 | 모드2 정답/일반 오답/빈 오답 | C2/C5 제목; 정답 0회, 일반·빈 오답 각각 `{text:"经济",pinyin:"jīngjì"}` 1회 | 실기기 입력기 |
| AC-05 | B열 빈칸도 버튼·A열 자연 발음 | C5 제목; 빈 pinyin에서 `{text:"经济"}`와 Audio play | 실제 발음 품질 |
| AC-06 | 재생 중 5회 클릭은 하나씩 처음부터, 재요청 없음 | `src/lib/ttsAudio.test.ts` — `재생 중 같은 Blob을 5회 눌러도 이전 source를 멈추고 하나씩 처음부터 재생한다`; play 5/pause 4/URL 교체를 단언. `src/lib/speak.test.ts` — `캐시 hit replay는 반환 전 동기로 Audio를 호출하고 추가 요청하지 않는다`는 추가 request 0회 | native Audio 실기기 |
| AC-07 | 로딩 중 연속 클릭은 요청 최대 1 | `src/lib/speak.test.ts` — `로딩 중 5회 replay는 요청과 manual 의도를 하나로 합치고 자동 재생을 추가하지 않는다`; request 1회 | 실제 네트워크 동시성 |
| AC-08 | 느린 응답 중 다음·종료·완료·401은 늦은 소리 없음 | C1의 빠른 판정/언마운트 늦은 응답 play 0, C4의 실제 App 401 pause/revoke; `worker/routes/tts.test.ts` — `진행 중 취소를 실제 Qwen adapter에 전달해 socket을 닫고 원래 reason을 보존한다` | 실제 페이지 종료 타이밍 |
| AC-09 | NotAllowedError는 조용히, 수동 재생 가능 | `src/lib/speak.test.ts` — `차단된 Blob은 유지하고 다음 manual replay는 fetch 없이 시작한다`; `PronunciationButton.test.tsx` — `자동 차단·실패는 live 안내 없이 조용히 표시한다` | 브라우저 autoplay 정책 |
| AC-10 | 네트워크/429/5xx/timeout은 학습 비차단, 자동 재시도/큐 없음 | `speak.test.ts` — `자동 실패는 조용히 끝나며 manual 재시도만 새 요청과 고정 안내를 만든다`; C4의 provider 503 인증·Study 유지; C6 5xx queue에서 TTS entry 부재 | 실제 제공자 오류 계측 |
| AC-11 | 200자/201자/공백 입력 | `worker/lib/tts/input.test.ts` — `1~200 코드 포인트와 확장 한자는 허용하고 공백·한자 없음·201자는 거부한다`; `speak.test.ts` — `비활성 capability와 유효하지 않은 입력은 요청·재생 없이 안정 snapshot을 제공한다` | 실제 긴 문장 청취 |
| AC-12 | 병음 xíng/háng/없음: ignored/absent, key 분리 | `worker/lib/tts/pronunciation.test.ts` — `없는 병음은 absent이고 값이 있으면 의미와 관계없이 ignored다`; `storage.test.ts` — `프로필/시트/B열 및 명시적 설정·텍스트 변경을 구분한다` | 다음자 발음 분리는 비보장; 청취 확인 |
| AC-13 | 같은 내용·설정 재사용, 변경은 새 key | `storage.test.ts` — `고정 튜플을 SHA-256으로 경로화하고 운영 무관 필드를 제외한다`, `프로필/시트/B열 및 명시적 설정·텍스트 변경을 구분한다` | 실제 R2 지속성 |
| AC-14 | 무인증/generic/off는 R2·제공자 전 거부, 학습 API 정상 | `routes/tts.test.ts` — `미인증은 빈 401과 no-store로 끝나며 R2/provider를 호출하지 않는다`; Mode1 generic/off 제목 | 배포 환경 binding |
| AC-15 | 키보드·모션줄이기·모바일 공개/도달/재생 | `Mode1Card.test.tsx` — `래퍼 자신의 transform 완료만 받아 답을 공개하고 키보드 초점을 판정으로 옮긴다`, `계산한 최대 transform 시간과 buffer 뒤 fallback으로 한 번 완료한다`; C1 play | 모바일/200% 실기기 |
| AC-16 | hidden 즉시 정지, 복귀 자동 재시작 없음 | C3 제목; pause/revoke와 visible fetch/play 0 | 실제 모바일 background |
| AC-17 | TTS 전후 같은 판정의 큐·기록·통계 | 두 C6 제목; success/503/off의 progress, q1/q4 answer·q3 review, `{correct:2,wrong:2}`, 동일 5xx queue | 실제 Sheets |
| AC-18 | 구 서버 capability 없음이면 TTS 미노출·학습 정상 | `wordsApi.test.ts` — `누락이면 off`; C2/C5의 off 정답 진행 | 혼재 배포 |
| AC-19 | 최초 저장 후 다른 수명 요청은 같은 바이트·provider 0 | S1/S3 제목; 새 controller/cache의 byte equality, put 추가 0과 provider route 없음 | 실제 기기/지역 R2 |
| AC-20 | provider 장애 중 hit 정상, R2 조회 실패 재합성 0 | `worker/lib/tts/service.test.ts` — `returns a valid R2 hit without contacting the provider or writing`; S2/S3 제목의 get reject/Qwen 0 | 실제 R2 장애 |
| AC-21 | write 실패/대기 초과에도 생성 음성 재생·큐 영향 없음 | S1/S3 제목의 UNCONFIRMED Audio play/replay; C6 5xx 제목의 TTS entry 부재; `worker/lib/tts/service.test.ts` — `returns validated generated audio when a put fails while observing the original promise`, `uses the same write budget for a conflict re-read and returns the winner bytes` | 실제 write deadline |
| AC-22 | 동시 최초 key는 후발 overwrite 없음 | `storage.test.ts` — `경합은 conflict로 구분하며 일반 put·재조회·재시도를 하지 않는다`; conditional write assertion | R2 원자성 관측 |
| AC-23 | 시트 추가/병음 수정/설정/삭제는 요청 키, 기존 파일 즉시 삭제 없음 | `storage.test.ts` — `프로필/시트/B열 및 명시적 설정·텍스트 변경을 구분한다`; `routes/tts.test.ts` — `프로필별 R2 키를 분리하며 TTS 경로에서 Sheets 호출을 추가하지 않는다` | 실제 시트 변경 후 보관 |
| AC-24 | 버킷 URL/다른 프로필 접근 차단·키 분리 | `routes/tts.test.ts` — `미인증은 빈 401과 no-store로 끝나며 R2/provider를 호출하지 않는다`, `프로필별 R2 키를 분리하며 TTS 경로에서 Sheets 호출을 추가하지 않는다` | private domain/lifecycle |

## 실행 결과

- `npm test -- src/screens/StudyScreen.tts.integration.test.tsx src/screens/ttsServerClient.integration.test.ts src/lib/speak.test.ts src/lib/ttsAudio.test.ts`: **4 files / 32 tests passed**, exit 0 (2026-09-17 KST).
- `npm test`: **55 files / 696 tests passed**, exit 0 (2026-09-17 KST).
- `npm run lint`: exit 0 (2026-09-17 KST).
- `npm run build`: exit 0 (2026-09-17 KST). 첫 샌드박스 실행은 Wrangler 사용자 로그 경로의 `EPERM`을 출력했지만 빌드는 완료했고, 정상 권한 재실행은 경고 없이 통과했다.
- `git diff --check`: exit 0 (2026-09-17 KST).

## 출시 인계

자동 테스트는 실제 R2 객체·비공개 도메인/lifecycle, 키 주입, 유료 Qwen 합성, 표본 청취, iOS Safari/Android Chrome/데스크톱 실기기 background·접근성, p95 지연을 검증하지 않는다. 이는 자동화된 내부 계약의 대체물이 아니라 출시 전 환경·청취 검증 항목이다.
