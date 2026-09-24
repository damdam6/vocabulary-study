# [TTS-12] 모드1 카드 구조와 정답 공개 접근성을 정리한다

> **17개 재편판** · GitHub 이슈 [#146](https://github.com/damdam6/vocabulary-study/issues/146). 승인된 구현 범위와 의존 관계를 기록한다. 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **[TTS-01 · #135](https://github.com/damdam6/vocabulary-study/issues/135)**. 모든 선행 결과가 머지되어야 한다(AND).
범위 크기: M. 이전 08의 카드 구조에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

현재 앞·뒷면이 하나의 button 안에 있어 발음 버튼을 넣으면 중첩 버튼이 된다. 먼저 기존 플립·판정을 유지하는 구조와 공개 완료 기준을 만든다.

## 기대 동작

1. 비대화형 플립 컨테이너와 앞면 공개 버튼·뒷면 내용 영역을 분리한다. 뒷면에 후속 제어를 배치할 자리를 확보한다.
2. 기존 revealed와 별도로 일회성 viewReady 기준을 만든다. transform 이벤트 target/propertyName 필터, 계산된 시간+100ms fallback, reduced motion/0초 전환을 함께 처리한다.
3. viewReady 전 뒷면은 접근성 트리·키보드에서 숨긴다. 공개 후 기존 키보드 초점만 판정 제어로 옮기고 다른 곳으로 이동한 초점을 빼앗지 않는다.
4. O/X의 기존 공개 직후 사용과 즉시 판정을 유지한다. 빠른 판정/언마운트 시 플립 timer를 정리한다.
5. 200자 표제어·긴 병음의 줄바꿈·카드 내부 스크롤과 판정 영역을 확보한다. generic에서도 기존 플립·판정이 유지되어야 한다. 음성은 아직 호출하지 않는다.

## 변경 대상과 소유 경계

- `src/screens/Mode1Card.tsx`
- `src/index.css의 모드1 플립 영역`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 음성 요청·자동재생·스피커 렌더·세션 연결·모드2 CSS.

## 완료 조건

- [ ] 중첩 button과 공개 전 답의 키보드/스크린리더 노출이 없다.
- [ ] 이벤트 중복·유실·0초 모션에서도 viewReady가 한 번 결정되고 timer가 정리된다.
- [ ] 빠른 O/X·generic·긴 콘텐츠의 기존 판정 경로가 유지된다.
- [ ] 음성 API/Audio 없이 구조와 공개 완료 동작을 독립 검증할 수 있다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

jsdom·fake timer로 구조·포커스·transition·fallback·generic 회귀를 검증한다. 실제 390px/200% 확대 확인은 출시 검증 항목으로 구분한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §7.3·§8; PRD AC-11·AC-15·AC-17.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
