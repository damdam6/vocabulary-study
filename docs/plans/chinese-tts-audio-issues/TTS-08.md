# [TTS-08] 음성 출력과 세션 Blob 캐시의 자원을 관리한다

> **17개 재편판** · GitHub 이슈 [#142](https://github.com/damdam6/vocabulary-study/issues/142). 승인된 구현 범위와 의존 관계를 기록한다. 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **[TTS-01 · #135](https://github.com/damdam6/vocabulary-study/issues/135)**. 모든 선행 결과가 머지되어야 한다(AND).
범위 크기: M. 이전 06의 자원에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

준비된 음성을 즉시 재생하고 반복 청취 시 다운로드와 Object URL 누수를 방지할 자원 모듈이 필요하다.

## 기대 동작

1. 세션당 HTMLAudioElement 하나를 관리하는 Audio 출력을 만든다. play(blob)는 호출 시 동기 경로에서 native play를 시작하고 결과 Promise를 노출한다.
2. 재생 중 재호출은 정지 후 처음부터 재생한다. source 세대 번호로 이전 play Promise와 audio event가 새 source 상태를 오염시키지 않게 한다.
3. Object URL은 현재 source에만 만들고 교체/stop/dispose 시 audio 연결을 끊은 뒤 revoke한다. NotAllowedError를 별도 결과로 전달한다.
4. Blob LRU를 최대 20개/8MiB로 제한한다. 현재 준비·재생용 항목을 pin/unpin할 수 있게 하고 cache clear/dispose를 제공한다.
5. Audio와 캐시는 controller에 주입 가능한 타입을 사용한다. stop은 재생 자원을 정리하고 cache는 명시적 clear/dispose까지 유지할 수 있게 분리한다.

## 변경 대상과 소유 경계

- `src/lib/ttsAudio.ts`
- `src/lib/ttsBlobCache.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 네트워크·질문 ID·자동재생 기회·React·visibility 이벤트 등록.

## 완료 조건

- [ ] 준비된 Blob 재생 전에 비동기 대기가 없고 겹쳐 재생되지 않는다.
- [ ] 이전 source의 늦은 resolve/reject/event가 현재 상태를 바꾸지 않는다.
- [ ] URL 생성/해제가 균형을 이루고 반복 dispose와 stop이 안전하다.
- [ ] 20개/8MiB의 먼저 도달하는 한도·LRU·pin 보호가 지켜지며 차단만으로 캐시가 사라지지 않는다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

Audio·Object URL·Blob 더블로 source 교체·늦은 완료·차단·정리와 LRU 한도를 검증한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §6.3·§7.4; PRD AC-06·AC-09.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
