# [TTS-07] 중국어 음성 API의 클라이언트 전송을 구현한다

> **17개 재편판** · GitHub 이슈 [#141](https://github.com/damdam6/vocabulary-study/issues/141). 승인된 구현 범위와 의존 관계를 기록한다. 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **[TTS-01 · #135](https://github.com/damdam6/vocabulary-study/issues/135)**. 모든 선행 결과가 머지되어야 한다(AND).
범위 크기: S. 이전 06의 전송에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

오디오 요청도 기존 인증·401·성공 콜백 계약을 따라야 하며 실패가 학습 기록 재시도 큐에 들어가면 안 된다.

## 기대 동작

1. apiFetch로 POST /api/tts를 호출하고 text/pinyin만 직렬화한다. provider에 직접 접근하지 않는다.
2. 정규화된 오류와 disabled/not_configured를 구별해 호출자에 전달한다. 401은 기존 공통 동작을 유지한다.
3. audio/mpeg·빈 바디·4MiB 상한을 실제 읽은 바이트로 검증해 Blob과 진단 결과를 반환한다.
4. 20초 준비 상한과 외부 AbortSignal을 연결하고 바디 읽기까지 취소·시간 제한을 적용한다. 완료·실패마다 타이머·리스너를 정리한다.

## 변경 대상과 소유 경계

- `src/lib/ttsApi.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** Audio·Blob 캐시·자동재생·React·사용자 메시지 표시.

## 완료 조건

- [ ] 기존 Bearer·401·정상 응답 콜백이 유지되고 retryQueue 적재는 없다.
- [ ] Content-Length 누락/거짓값·잘못된 MIME·빈/과대 오디오를 거부한다.
- [ ] fetch 중/바디 읽기 중 취소·timeout이 끝나며 자동 재요청은 없다.
- [ ] 실제 서버 없이 계약 fixture로 테스트할 수 있다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

fetch/stream/clock 더블로 HTTP와 실제 바디 상한·취소를 검증한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §3·§7.1; PRD AC-07·AC-08·AC-10.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
