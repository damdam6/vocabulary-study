# [TTS-04] Qwen WebSocket 합성과 연결 수명을 구현한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-03**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: M. 이전 04의 연결 처리에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

이벤트 처리기를 실제 Workers WebSocket에 연결하고 취소·실패·늦은 Upgrade에도 연결이 남지 않게 해야 한다.

## 기대 동작

1. 국제 endpoint에 Bearer secret과 Upgrade 헤더로 fetch한다. redirect를 거부하고 101/webSocket을 확인한다. 리스너 등록·accept 후 task를 시작한다.
2. TTS-03 처리기가 요청한 순서대로 보내고 받은 text/binary를 처리기에 전달한다. task-started 후 원문 한 번과 finish-task를 보내며 task-finished까지 기다린다.
3. 서비스에서 받은 AbortSignal을 handshake·열린 task에 연결한다. 이미 취소됐으면 연결하지 않고, 늦게 열린 socket도 닫는다. 12초 합성 deadline은 TTS-05가 생성한다.
4. 성공·task-failed·조기 close·socket error·abort 모두 한 번만 settle하고 리스너·abort handler·socket을 정리한다. 취소 시 가능한 cancel 전송은 best effort로 하며 기다리지 않는다.
5. handshake 인증/권한/429는 503, 5xx·잘못된 Upgrade/프로토콜은 502로 정규화한다. pronunciationMode=none인 TtsProvider를 반환한다. 자동 재연결·재합성·벤더 전환은 없다.

## 변경 대상과 소유 경계

- `worker/lib/tts/providers/qwen.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 이벤트 파서·MP3 파서 재구현, R2·HTTP 라우트·deadline 중복 타이머.

## 완료 조건

- [ ] 한 합성당 연결·task가 하나이고 완료 전 close는 부분 성공이 아니다.
- [ ] 연결 중/수신 중/완료 직후 취소와 늦은 Upgrade에서 누수·중복 settle이 없다.
- [ ] 신호 취소가 이벤트 대기를 끝내며 timeout 원인은 호출부에 보존된다.
- [ ] 키·원문·병음·제공자 원문 에러가 로그·응답에 나오지 않는다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

Upgrade 응답 전용 더블과 WebSocket message/close/error로 전체 수명을 검증한다. 일반 Node Response가 101을 지원한다고 가정하지 않는다. 실제 키 없이 실행한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §2.2~2.4·§4; PRD AC-08·AC-10.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
