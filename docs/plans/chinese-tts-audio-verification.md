# 중국어 TTS 출시 전 자동 검증 기록 (#150)

## 범위와 실행 기준

- 브랜치: `feat/150-chinese-audio-integration-tests` (base: `feat/ch-sound`)
- 구현 기준: #140, #147, #148이 포함된 `d6c7e11`에서 시작
- 외부 더블: R2 bucket, Qwen Upgrade/WebSocket, HTTP, native Audio/Object URL, 시간 경계만 대체했다. 실제 Worker route/service/storage/Qwen adapter 및 클라이언트 transport/controller/audio/cache는 유지했다.
- 운영 설정·실제 키·실제 버킷·유료 TTS 호출·배포는 수행하지 않았다. 테스트 fixture의 `TTS_ENABLED=true`만 격리해 사용했으며 운영 기본 off를 바꾸지 않았다.

## #150 대표 통합 증거

| 식별자 | 자동 테스트(정확한 제목) | 결과 | 보완/한계 |
| --- | --- | --- | --- |
| S1 | `worker/tts.integration.test.ts` — `실제 route 응답이 분리된 controller/cache 수명과 Audio까지 도달하고 UNCONFIRMED는 같은 세션에서 재생한다` | 통과. 실제 `put` 바이트가 첫 controller/audio에서 재생되고, 새 controller/cache가 `STORED/PRESENT` 바이트를 재생하며 provider/put은 추가 0회다. | 실제 R2·다른 기기 지속성은 출시 확인이다. |
| S2 | `worker/tts.integration.test.ts` — `조회 장애는 합성하지 않고...` | 통과. `get` reject는 `503 tts_storage_unavailable`, Qwen/put 0회였다. | R2 권한·네트워크 장애 실측은 미검증이다. |
| S3 | 같은 S1 테스트의 UNCONFIRMED 절 | 통과. write reject의 실제 route 응답이 transport/controller/cache/Audio에 도달하고 수동 replay는 추가 fetch 없이 같은 Blob을 재생했다. | 저장 deadline/늦은 완료 조합은 `worker/lib/tts/service.test.ts`의 상세 단위 증거를 재사용한다. |
| S4 | `worker/tts.integration.test.ts` — `provider 인증 실패는 앱 인증 401과 분리되고...` | 통과. provider 401은 WWW-Authenticate 없는 503, 앱 인증 실패는 storage/provider 전에 401로 끝났다. | 실제 로그인 화면 전환은 `src/lib/ttsApi.test.ts`의 401 인증 정리 증거를 재사용한다. |
| C1 | `src/screens/StudyScreen.tts.integration.test.tsx` — `StrictMode 모드1은 공개 완료 뒤 실제 transport/controller/audio를 한 번만 연결하고 빠른 판정 뒤 늦은 완료를 막는다` | 통과. 실제 훅/controller/transport/audio/cache 경로에서 결함을 재현하고 수정 후 1회 재생·늦은 transition 차단을 확인했다. | 재현된 결함만 `Mode1Card.tsx`에서 최소 수정했다. |
| C2 | `src/screens/StudyScreen.tts.integration.test.tsx` — `모드2 빈 오답만 정답 표제어를 요청하며...` | 통과. 빈 오답 결과는 정답 A열 `经济`만 요청하고, 정답 제출은 TTS 요청 없이 진행됐다. | 일반 오답/StrictMode 공개의 상세 UI 분기는 `src/screens/Mode2Card.test.tsx`를 재사용한다. |
| C3 | `src/screens/StudyScreen.tts.integration.test.tsx` — `hidden은 실제 Audio URL을 정리하고...` | 통과. hidden에서 pause/src 제거/URL revoke, visible 복귀의 자동 요청·재생 0회, 수동 replay의 cache 재생을 확인했다. | 실제 모바일 background/foreground는 출시 확인이다. |
| C4 | `src/screens/StudyScreen.tts.integration.test.tsx` — `실제 App/Home/Study 경계에서 provider 503은...` | 통과. 503은 password/Study를 유지하고 실제 `apiFetch` 401 handler는 App을 Login으로 전환해 Study를 unmount했다. | 실제 배포 로그인은 출시 확인이다. |
| C5 | `src/screens/StudyScreen.tts.integration.test.tsx` — `모드2 빈 오답만...`의 off 정답 절 | 통과. off capability에서 기존 모드2 정답 진행과 feedback을 유지하고 TTS 요청은 만들지 않았다. | generic/legacy words 포맷은 `src/lib/wordsApi.test.ts`, `worker/routes/words.test.ts`의 선행 증거를 재사용한다. |
| C6 | `src/screens/StudyScreen.tts.integration.test.tsx` — `TTS 성공·실패·off 모두 같은 모드1 채점 기록을 남긴다` | 통과. 세 경우 모두 동일 answer record를 남기며 TTS 요청 수만 1/1/0으로 달랐다. | 복습 포함 4문제 transcript·통계/재시도 큐 조합은 `src/lib/studySession.test.ts`, `src/lib/sessionQueue.test.ts`, `src/lib/retryQueue.test.ts`의 상세 증거를 재사용한다. |
| C7 | `src/screens/StudyScreen.tts.integration.test.tsx` — `실제 App success callback은 TTS 200 뒤...` | 통과. TTS 200의 실제 App success handler가 기존 answer retry를 flush하고 TTS는 queue에 들어가지 않았다. | 중간 HTTP 수는 failure/off와 동일하다고 가정하지 않는다. |

## AC-01~24 추적

| AC | 자동 증거 | 출시 전 추가 확인 |
| --- | --- | --- |
| AC-01 | generic은 UI/요청 0회·직접 API 403: `Mode1Card.test.tsx` 및 `routes/tts.test.ts` | 실제 배포 capability |
| AC-02 | 모드1 공개 뒤 1회 자동 재생: C1의 transition→play 1회 | 실제 청취 |
| AC-03 | 모드2 오답만 정답 A열 요청: C2의 빈 오답 body assertion | 실제 청취 |
| AC-04 | 수동 replay가 판정/제출을 만들지 않음: C1/C2 및 `ttsAudio.test.ts` | 실제 브라우저 정책 |
| AC-05 | A열만 provider 입력: `qwenProtocol.test.ts` | 실제 음질 |
| AC-06 | 1~200자 입력 제한: `input.test.ts` | 실제 긴 문장 청취 |
| AC-07 | 오류가 학습을 막지 않음: C4/C6 | 실제 네트워크 |
| AC-08 | 자동/수동 오류 UX: `speak.test.ts` | 실제 브라우저 메시지 |
| AC-09 | MP3·진단 headers: `routes/tts.test.ts` | 실제 provider |
| AC-10 | Qwen event 순서: `qwenProtocol.test.ts` | 실제 socket |
| AC-11 | socket 취소/timeout: `qwen.test.ts` | 실제 endpoint |
| AC-12 | 병음은 key/진단만: `pronunciation.test.ts` | 다음자 청취 |
| AC-13 | 설정 변경 key 분리: `storage.test.ts` | 실제 R2 지속성 |
| AC-14 | 인증/generic/off 차단: S4 및 `routes/tts.test.ts` | #149 binding |
| AC-15 | 공개 전 숨김·키보드: C1 및 `Mode1Card.test.tsx` | 실기기 접근성 |
| AC-16 | hidden 정지·복귀 수동만: C3 | 모바일 background |
| AC-17 | 채점/기록/retry 분리: C6 및 `studySession.test.ts` | 실제 Sheets |
| AC-18 | 구 capability off: C5 및 `wordsApi.test.ts` | 혼재 배포 |
| AC-19 | 새 controller/cache 재사용: S1 | 다른 기기/지역 |
| AC-20 | read 장애 재합성 0회: S2 | 실제 R2 장애 |
| AC-21 | write 실패 UNCONFIRMED 재생: S3 | 실제 저장 지연 |
| AC-22 | If-None-Match 조건 저장: S1 및 `storage.test.ts` | 실제 원자성 |
| AC-23 | 요청이 Sheets를 읽지 않음: `routes/tts.test.ts` | 시트 변경/삭제 |
| AC-24 | profile key 분리·인증: S4 및 `routes/tts.test.ts` | private domain/lifecycle |

## 실행 결과

- `npm test -- src/screens/StudyScreen.tts.integration.test.tsx worker/tts.integration.test.ts src/screens/Mode1Card.test.tsx src/screens/Mode2Card.test.tsx src/hooks/usePronunciation.test.tsx src/lib/ttsApi.test.ts worker/routes/tts.test.ts`: **82 tests passed**, exit 0 (2026-09-16 KST).
- `npm run lint`: exit 0 (2026-09-16 KST).
- `npm test`: **54 test files / 688 tests passed**, exit 0 (2026-09-16 KST). #140의 과거 보고값 664가 아닌, 이 통합 base의 실제 실행값이다.
- `npm run build`: Worker 및 client Vite build 통과, exit 0 (2026-09-16 KST). 첫 sandbox 실행의 Wrangler 사용자 로그 경로 `EPERM` 경고 뒤, 정상 권한 재실행에서 경고 없이 통과했다.
- `git diff --check`: exit 0 (2026-09-16 KST).

## 출시 인계 (#149 / #151)

자동 더블 통과는 출시 승인이나 실제 R2 증거가 아니다. #149/#151에서 다음을 확인한다.

1. 실제 private R2 binding·도메인·lifecycle과 `DASHSCOPE_API_KEY` 주입(값은 출력하지 않음).
2. 운영 `TTS_ENABLED=false` 유지 상태의 배포 호환성, 활성화 전 rollback 절차.
3. 실제 기기 청취(다음자·문장·20 표본), 모바일 background/foreground, 390px/200% 확대, p95 지연.
4. 실제 시트 변경/삭제 뒤 파일 보관, 기기·지역·재배포 간 재사용, R2 장애/경합 관측.
