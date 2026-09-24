# [TTS-10] 공통 발음 버튼과 재생 상태 표시를 구현한다

> **17개 재편판** · GitHub 이슈 [#144](https://github.com/damdam6/vocabulary-study/issues/144). 승인된 구현 범위와 의존 관계를 기록한다. 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **[TTS-01 · #135](https://github.com/damdam6/vocabulary-study/issues/135)**. 모든 선행 결과가 머지되어야 한다(AND).
범위 크기: S. 이전 07의 공통 UI에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

두 학습 카드가 같은 재생·로딩·실패 UI를 사용하도록 표시 전용 컴포넌트를 만든다.

## 기대 동작

1. [TTS-01 · #135](https://github.com/damdam6/vocabulary-study/issues/135)의 상태·callback prop을 받는 표시 전용 버튼을 구현한다. provider·controller·API를 직접 만들거나 호출하지 않는다.
2. type=button, 44×44px 이상, SVG 20px, aria-label/aria-busy와 비활성 설명·수동 오류의 aria-live를 적용한다.
3. 준비/재생/자동 차단/수동 오류/사용 불가 상태를 표시한다. 자동 실패에는 토스트·오류 알림을 추가하지 않는다.
4. 기존 디자인 토큰을 쓰는 전용 CSS로 버튼·메시지 공간을 고정한다. src/index.css와 카드 레이아웃은 수정하지 않는다.

## 변경 대상과 소유 경계

- `src/components/PronunciationButton.tsx`
- `src/components/PronunciationButton.css`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 세션 전달·controller 생성·학습 카드 레이아웃·플립.

## 완료 조건

- [ ] 클릭 한 번에 전달된 replay callback만 호출하고 submit·판정을 일으키지 않는다.
- [ ] 로딩·오류·비활성 상태의 접근성 설명과 최소 터치 영역이 있다.
- [ ] 자동 차단은 조용히 표시하고 수동 오류만 안내한다.
- [ ] 외부 서비스·실제 player 없이 모든 상태를 렌더할 수 있다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

기존 jsdom 렌더 도구로 상태·키보드·callback을 검증하고 스타일을 확인한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §8; PRD AC-05·AC-09·AC-10·AC-15.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
