# [TTS-01] 중국어 TTS 공통 계약·입력·설정·병음 정책을 정의한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **없음 — 자동 그래프의 루트**. 공유 문서·베이스(P0)와 확정 제공자(P1) 준비 후 시작한다.
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: M. 이전 01 + 02에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

후속 Worker·클라이언트가 같은 요청·오류·재생 계약을 사용해야 한다. Qwen 전환 후 병음 정책은 미적용 판정만 남았으므로 공통 입력 처리에 포함한다.

## 기대 동작

1. TtsConfig·TtsEnv·SynthesisInput·PronunciationDecision·TtsProvider·TtsCapability와 오류/헤더 계약을 정의한다. provider 입력은 text만, 결과는 MP3와 선택적 billedCharacters다.
2. NFC·trim·줄바꿈 정규화, 1~200 코드 포인트·한자 포함·허용 제어문자, JSON 객체·알 수 없는 필드·16KiB 바디·pinyin 1,000자 상한을 검증한다. Content-Length만 믿지 않는다.
3. 병음 생략·빈칸은 absent, 값이 있으면 ignored/provider_hint_unsupported, effectiveHint=null로 반환한다. 정규화한 B열은 키 입력으로 보존하고 합성 입력과 분리한다.
4. TTS_ENABLED=false, provider=qwen, 확정 모델·음색·유한 rate [0.5,2.0], revision 형식·키·R2 유무를 검증한다. optional TtsEnv를 기존 Env와 조합하고 실제 바인딩은 TTS-15에 맡긴다.
5. Worker의 MP3 검사 함수 주입 계약과 클라이언트 전송·Blob 캐시·Audio 출력·controller·카드 음성 prop 계약을 타입으로 명시한다. src/worker 빌드 경계를 유지한다. 후속 파일 구현은 포함하지 않는다.

## 변경 대상과 소유 경계

- `worker/lib/tts/types.ts`
- `worker/lib/tts/config.ts`
- `worker/lib/tts/input.ts`
- `worker/lib/tts/pronunciation.ts`
- `src/lib/ttsTypes.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 실제 MP3 검사기·R2·provider·API 라우트·Audio 구현, Wrangler·생성 Env 편집.

## 완료 조건

- [ ] 0/201자·한자 없음·금지 제어문자·과대 바디·잘못된 JSON/pinyin 타입이 거부되고 200자 문장은 허용된다.
- [ ] 병음 유무와 의미에 관계없이 유효한 A열을 보존하며 xíng/háng은 모두 ignored다.
- [ ] 키·R2·잘못된 설정은 TTS만 끄고 기존 프로필 설정 계약을 바꾸지 않는다.
- [ ] 후속 구현이 공통 타입·제한·fixture를 재정의하지 않고 사용할 수 있다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

node 단위 테스트로 입력 경계·거짓/누락 Content-Length·설정 오류·병음 입력 분리를 검증한다. 네트워크·오디오 구현을 추가하지 않는다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §2.2·§3·§5·§9; PRD AC-05·AC-11·AC-12·AC-14·AC-18.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
