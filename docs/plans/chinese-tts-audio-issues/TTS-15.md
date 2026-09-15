# [TTS-15] 중국어 TTS의 Worker 환경과 R2 바인딩을 연결한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-06**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: S. 이전 10의 환경에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

완성된 Worker 경로에 실제 버킷 식별자와 생성 Env 타입을 연결한다. 실제 버킷 준비가 필요한 유일한 구현 환경 경계로 분리한다.

## 기대 동작

1. P2에 준비된 실제 검증/운영 버킷을 TTS_AUDIO로 연결한다. 버킷 이름을 추측하거나 만들어졌다고 기록하지 않는다. 준비가 없으면 이 이슈의 환경 연결은 대기 상태로 둔다.
2. provider=qwen, model=qwen-audio-3.0-tts-flash, voice=longanfengyue, rate=1.0, revision=tts-v1을 명시하고 TTS_ENABLED=false를 유지한다.
3. npm run cf-typegen으로 타입을 재생성한다. TTS-01의 optional TtsEnv는 그대로 사용하며 생성 타입을 수동 편집하지 않는다.
4. 환경별 바인딩·비공개·자동 만료 없음과 DASHSCOPE_API_KEY 주입 여부를 환경 기록에 적는다. 키 발급 완료·실제 주입·접근 성공을 구분한다. 확인하지 않은 상태는 미확인으로 남긴다.

## 변경 대상과 소유 경계

- `wrangler.jsonc`
- `worker-configuration.d.ts`
- `docs/plans/chinese-tts-audio-environment.md`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 배포·운영 활성화·계정/버킷 생성·유료 호출·제품 PRD 개정.

## 완료 조건

- [ ] 실제 버킷 식별자와 바인딩이 준비 기록과 일치하며 운영 flag는 false다.
- [ ] 생성 Env와 빌드가 통과하고 시크릿 값이 추적 파일·번들에 없다.
- [ ] 검증/운영별 설정과 아직 필요한 키 주입·접근 확인이 명시돼 있다.
- [ ] 환경 준비가 늦어도 TTS-16 자동 회귀를 막는 의존성을 만들지 않는다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

cf-typegen·build·lint와 추적 파일의 설정을 확인한다. 실제 연결·청취 성공을 이 검증으로 대신하지 않는다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §9·§12; PRD AC-18·AC-24 및 출시 환경.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
