# [TTS-09] 질문별 음성 재생과 늦은 응답을 제어한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-07, TTS-08**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: M. 이전 06의 제어에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

API·Audio·캐시를 연결해 빠른 문제 이동과 중복 클릭에도 현재 문제의 소리만 재생해야 한다.

## 기대 동작

1. 주입받은 전송/Audio/cache를 사용하는 React 비의존 controller를 만든다. activate/prepare/reveal/replay/stop/dispose/getSnapshot/subscribe를 제공한다.
2. 세션 ID+pos와 generation으로 모든 비동기 완료를 검증한다. activate는 동일 질문에 멱등이고 이전 질문의 요청·재생을 중단한다.
3. viewReady와 autoConsumed를 관리해 공개당 자동 기회 1회만 사용한다. prepare 실패 후 reveal 자동 재요청은 없고 수동 의도가 자동 기회를 소비한다.
4. 로딩 중 연속 클릭은 요청 하나·재생 의도 하나로 합친다. 캐시 hit는 동기 Audio 재생 경로를 사용하며 차단 후 Blob을 유지한다.
5. stop/hidden/exit는 현재 요청·재생·의도를 무효화하고 자동 재개하지 않는다. dispose는 구독·cache·Audio까지 해제한다. disabled 응답은 세션 기능을 끈다.

## 변경 대상과 소유 경계

- `src/lib/speak.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** DOM·React 수명·카드 플립·Audio/LRU/전송 재구현.

## 완료 조건

- [ ] A 응답이 B 이후 도착해도 A를 재생하거나 B 상태를 바꾸지 않는다.
- [ ] 로딩 중 요청은 최대 하나, 캐시 재생의 추가 요청은 0회다.
- [ ] 자동 실패·차단 후 자동 재시도는 없으며 수동 재시도는 가능하다.
- [ ] 공개/수동/숨김이 교차해도 자동 기회·단일 재생·정리 계약이 지켜진다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

전송·Audio·cache 포트 더블과 제어 가능한 Promise로 의도와 도착 순서를 검증한다. 각 자원 모듈의 세부 테스트를 복제하지 않는다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §7.1~7.4; PRD AC-06~10·AC-16.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
