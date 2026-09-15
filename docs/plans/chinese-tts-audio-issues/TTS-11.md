# [TTS-11] 음성 capability와 플레이어를 학습 세션에 연결한다

> **17개 재편판** · GitHub 이슈 [#145](https://github.com/damdam6/vocabulary-study/issues/145). 승인된 구현 범위와 의존 관계를 기록한다. 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **[TTS-09 · #143](https://github.com/damdam6/vocabulary-study/issues/143), [TTS-10 · #144](https://github.com/damdam6/vocabulary-study/issues/144), [TTS-12 · #146](https://github.com/damdam6/vocabulary-study/issues/146)**. 모든 선행 결과가 머지되어야 한다(AND).
범위 크기: M. 이전 07의 세션 연결에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

완성된 controller와 UI 계약을 실제 세션에 연결하고 문제 이동·종료에서 즉시 정지시켜야 한다. 모드1 파일의 동시 수정을 피하려고 [TTS-12 · #146](https://github.com/damdam6/vocabulary-study/issues/146) 완료 후 시작한다.

## 기대 동작

1. words의 tts 누락/잘못된 형식은 off로 처리하고 Home→App→Study에 profile/tts 스냅샷을 전달한다. 별도 localStorage를 추가하지 않는다.
2. Study 수명에서 controller를 생성·구독·dispose한다. usePronunciation은 controller와 카드 binding을 잇고 StrictMode 재설정에서도 disposed 객체를 재사용하지 않는다.
3. 즉시 판정·다음·종료·완료·401 unmount·hidden·pagehide에서 동기 stop을 호출한다. 마지막 피드백 대기 중에도 정지한다.
4. supportsPronunciation(contentType)와 capability를 함께 적용한다. generic/off에는 controller 요청과 버튼 binding이 없다.
5. 두 카드에는 [TTS-01 · #135](https://github.com/damdam6/vocabulary-study/issues/135)의 선택적 음성 prop 타입만 추가하고 전달한다. 버튼 렌더·공개 시점 호출은 [TTS-13 · #147](https://github.com/damdam6/vocabulary-study/issues/147), [TTS-14 · #148](https://github.com/damdam6/vocabulary-study/issues/148)에서 구현한다. CSS와 카드 내부 플립 상태는 수정하지 않는다.

## 변경 대상과 소유 경계

- `src/lib/wordsApi.ts`
- `src/screens/HomeScreen.tsx`
- `src/App.tsx`
- `src/screens/StudyScreen.tsx`
- `src/hooks/usePronunciation.ts`
- `src/lib/contentLabels.ts`
- `src/screens/Mode1Card.tsx의 선택적 음성 prop 선언`
- `src/screens/Mode2Card.tsx의 선택적 음성 prop 선언`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 버튼·controller 재구현, 카드 음성 공개 동작, 공통/카드 CSS.

## 완료 조건

- [ ] 구 서버·generic·disabled에서 기존 학습이 유지되고 tts는 홈 응답 기준으로 고정된다.
- [ ] StrictMode setup/cleanup 후 정상 controller 한 개만 살아 있다.
- [ ] 질문 진행·로그인 복귀·완료·숨김에서 즉시 정지하고 복귀 자동 재개는 없다.
- [ ] 학습 판정·큐·기록 전송은 음성 작업을 기다리지 않으며 카드 음성 prop은 선택적이다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

Home/App/Study 경계와 hook을 controller 더블로 검증한다. 기존 session/기록 회귀를 확인하되 버튼·플립·재생 알고리즘은 재검증하지 않는다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §3.3·§7.5; PRD AC-01·AC-08·AC-16~18.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
