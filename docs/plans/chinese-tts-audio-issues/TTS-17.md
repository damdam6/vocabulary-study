# [TTS-17] 중국어 TTS 운영·출시 절차와 제품 문서를 완성한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-15, TTS-16**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: S. 이전 10의 문서에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

최종 구현·자동 검증 결과와 환경 준비 기록을 모아 운영자가 남은 출시 확인을 수행할 수 있게 한다.

## 기대 동작

1. 기존 PRD의 TTS 비목표·API·화면 설명을 개정하고 B열 미적용·capability·버튼 상태를 최종 구현과 맞춘다.
2. TTS-15 환경 기록과 TTS-16 검증 결과를 운영 문서에서 연결한다. 버킷·시크릿 주입·연결의 확인 상태를 그대로 유지한다.
3. R2 저장 재사용·Qwen task 완료·UNCONFIRMED·usage.characters 기반 비용·revision 롤백·이전 파일 정리를 실행 순서로 적는다.
4. 실제 중국어 청취·iOS/Android 자동재생·비공개 R2 격리/재사용·지연 측정·활성화의 출시 체크리스트를 작성한다. 미실행 항목은 미완료로 둔다.
5. 등록 직후 선생성·배치·강제 병음·자동 파일 삭제가 첫 범위에 포함되지 않았음을 문서 간 일치시킨다.

## 변경 대상과 소유 경계

- `docs/PRD.md`
- `docs/PRD-general.md`
- `docs/design-prd.md`
- `docs/PRD-chinese-tts-audio.md`
- `docs/architecture/chinese-tts-audio.md`
- `docs/plans/chinese-tts-audio-operations.md`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 앱 코드·생성 Env 재수정·실제 배포·과금 호출·버킷 삭제.

## 완료 조건

- [ ] 기존 3개 PRD와 신규 설계가 저장·길이·재생·병음·API 상태에서 일치한다.
- [ ] 검증 증거·환경 기록·운영 절차의 링크가 유효하다.
- [ ] 키 원문 없이 환경별 주입 절차를 안내하며 무료량 미확인 상태를 보존한다.
- [ ] 자동 그래프 완료와 실제 출시 검증 완료가 구분된다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

문서 링크·설정명·AC 매핑과 최종 코드 일치를 검토한다. 문서 수정만을 이유로 이미 통과한 앱 검사를 반복하지 않는다.

문서 전용 변경은 링크·계약·검증 기록을 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §9~12; PRD §9~10.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
