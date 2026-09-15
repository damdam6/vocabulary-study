# [TTS-03] Qwen 이벤트 검증과 MP3 조립을 구현한다

> **17개 재편판** · GitHub 이슈 [#137](https://github.com/damdam6/vocabulary-study/issues/137). 승인된 구현 범위와 의존 관계를 기록한다. 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **[TTS-01 · #135](https://github.com/damdam6/vocabulary-study/issues/135)**. 모든 선행 결과가 머지되어야 한다(AND).
범위 크기: M. 이전 04의 순수 처리에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

WebSocket 연결과 분리해 Qwen 메시지 순서·형식·부분 오디오를 검증할 수 있어야 한다.

## 기대 동작

1. 확정 모델·설정·UUID·원문을 받아 run-task/continue-task/finish-task/cancel 메시지를 직렬화하는 순수 함수를 만든다. API 키나 socket은 받지 않는다.
2. task-started/result-generated/task-finished/task-failed의 ID·순서를 검사한다. JSON 오류·잘못된 ID·순서 위반과 task 오류를 공통 오류 코드로 변환한다.
3. 바이너리만 수신 순서대로 모은다. 오디오 총 4MiB, JSON 하나 64KiB·총 1MiB를 초과하면 중단하고 부분 결과를 성공으로 내보내지 않는다.
4. task-finished와 유효한 비어 있지 않은 MP3가 함께 있어야 완료 결과를 만든다. usage.characters는 유효할 때만 포함한다.
5. Worker 공용 validateMp3를 audio.ts에 제공한다. R2와 제공자가 같은 검사를 사용하도록 하고 HTML/JSON·손상·빈 오디오를 거부한다. 병음·SSML·instruction·hot_fix를 직렬화하지 않는다.

## 변경 대상과 소유 경계

- `worker/lib/tts/providers/qwenProtocol.ts`
- `worker/lib/tts/audio.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 실제 연결·인증 헤더·timeout·socket 정리·R2 호출.

## 완료 조건

- [ ] JSON과 여러 binary 조각이 섞여 와도 완성 MP3가 원래 순서로 조립된다.
- [ ] task-finished 누락·task-failed·ID/순서 위반·잘못된 JSON·상한 초과는 성공이 아니다.
- [ ] 사용량 누락을 원문 길이로 추정하지 않고 에러에 제공자 원문을 담지 않는다.
- [ ] 메시지 처리 자체가 socket·timer·R2·fetch를 사용하지 않는다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

순수 이벤트 fixture로 정상·오류 순서와 바이트 조립을 검증한다. 재사용 가능한 최소 유효 MP3와 손상 fixture를 제공한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §2.3~2.4·§3.1; PRD AC-10·AC-12·AC-19.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
