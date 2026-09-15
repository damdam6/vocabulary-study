# [TTS-14] 모드2 오답 결과에 정답의 중국어 음성을 연결한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-11**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: M. 이전 09에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

오답 결과가 남는 동안 정답 표제어를 읽고 정답 입력 후에는 이전 음성이 다음 문제에 겹치지 않아야 한다.

## 기대 동작

1. wrongAnswer !== null인 결과 DOM이 반영된 뒤 reveal을 한 번 호출한다. 빈 문자열 오답도 포함하며 onJudged(false)의 기록 로직에 붙이지 않는다.
2. 정답 A열 옆에 공통 버튼을 렌더한다. 뜻·사용자 오답은 합성 입력으로 보내지 않는다.
3. 입력 중·정답 경로는 요청/재생 0회다. 다음·종료는 음성 준비·재생을 기다리지 않고 세션 정리 계약을 사용한다.
4. generic/off·B열 빈칸·200자 결과·키보드 포커스를 처리한다. 긴 결과의 wrapping/scroll은 모드2 전용 CSS에 한정하고 공통·모드1 스타일은 수정하지 않는다.

## 변경 대상과 소유 경계

- `src/screens/Mode2Card.tsx`
- `src/screens/Mode2Card.css`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 공통 버튼·controller·모드1·src/index.css 변경.

## 완료 조건

- [ ] 정답 0회, 일반/빈 오답은 공개당 자동 기회 1회다.
- [ ] 재생 대상이 word.hanzi이고 수동 클릭이 submit·판정을 유발하지 않는다.
- [ ] 다음·종료·StrictMode에서 늦은 응답이나 중복 재생이 없다.
- [ ] 빈 병음·긴 문장·generic 결과 UI와 접근성이 유지된다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

jsdom으로 입력/정답/오답/빈 오답과 수동 클릭·빠른 다음·포커스를 검증한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §7~8; PRD AC-01·AC-04~05·AC-08·AC-11·AC-15.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
