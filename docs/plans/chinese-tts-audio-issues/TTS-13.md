# [TTS-13] 모드1 정답 공개 시 중국어 음성을 연결한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-11**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: S. 이전 08의 음성 연결에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

TTS-12의 안정된 공개 완료 기준과 TTS-11의 카드 binding을 연결한다.

## 기대 동작

1. 플립 클릭에서 prepare를 호출할 수 있게 하고 기존 viewReady가 된 뒤 reveal을 한 번 호출한다. transition 계산·fallback을 다시 구현하지 않는다.
2. 병음 옆에 공통 PronunciationButton을 렌더하고 B열이 없어도 영역을 유지한다. 앞면/플립 중에는 조작·재생이 없다.
3. 키보드 공개 후 사용할 수 있으면 발음 버튼으로, 없으면 판정 제어로 초점을 옮기는 기존 정책을 완성한다.
4. 수동 클릭은 replay만 수행한다. generic/off에서 버튼·호출을 만들지 않고 빠른 판정 뒤 늦은 공개가 재생을 시작하지 않게 한다.

## 변경 대상과 소유 경계

- `src/screens/Mode1Card.tsx`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 플립 구조·시간 제한 재설계, controller·세션·CSS 구현.

## 완료 조건

- [ ] 앞면 요청 0회·플립 중 재생 0회·완료 후 자동 기회 1회다.
- [ ] 중복 이벤트·fallback·StrictMode가 reveal을 중복시키지 않는다.
- [ ] 병음 빈칸·긴 텍스트에서 버튼이 보이며 클릭으로 판정하지 않는다.
- [ ] 빠른 판정·종료 뒤 이전 질문이 재생되지 않는다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

카드 binding 더블로 prepare/reveal/replay 시점과 횟수를 검증한다. 플립 구조 테스트는 TTS-12에서 유지한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §7.3~7.4·§8; PRD AC-01~03·AC-05·AC-08·AC-15.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
