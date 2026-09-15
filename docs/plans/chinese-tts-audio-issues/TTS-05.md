# [TTS-05] 중국어 음성 조회·합성·저장 서비스를 연결한다

> **17개 재편판** · GitHub 이슈 [#139](https://github.com/damdam6/vocabulary-study/issues/139). 승인된 구현 범위와 의존 관계를 기록한다. 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **[TTS-02 · #136](https://github.com/damdam6/vocabulary-study/issues/136), [TTS-04 · #138](https://github.com/damdam6/vocabulary-study/issues/138)**. 모든 선행 결과가 머지되어야 한다(AND).
범위 크기: M. 이전 05의 서비스에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

R2와 Qwen 모듈을 조합해 조회 실패에는 재합성하지 않고 저장 실패에도 생성된 음성을 제공해야 한다.

## 기대 동작

1. 검증된 프로필·입력·설정·signal과 저장소/provider/clock/백그라운드 작업 등록 함수를 받는 서비스를 만든다. HTTP Request/Response와 인증 분기는 포함하지 않는다.
2. [TTS-03 · #137](https://github.com/damdam6/vocabulary-study/issues/137)의 validateMp3를 R2 저장 모듈에 주입한다. 조회는 바디·검증 포함 2초이며 정상 null에만 제공자를 한 번 호출한다.
3. 합성 시작 시 하나의 12초 deadline을 만들고 사용자 취소와 합쳐 adapter에 전파한다. timeout은 504용 tts_timeout으로 구분하고 정리한다.
4. 생성 후 조건부 put과 경합 재조회를 합계 2초 안에서 처리한다. 반환 결과는 STORED/PRESENT, GENERATED/SAVED, GENERATED/UNCONFIRMED 중 하나다.
5. 원래 put Promise를 백그라운드 작업 등록 함수로 넘겨 늦은 성공·실패를 관측한다. 조회 오류는 503, 저장 실패·대기 초과는 생성 MP3 반환이다. 합성 실패·부분 파일은 저장하지 않는다.

## 변경 대상과 소유 경계

- `worker/lib/tts/service.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 앱 인증·메서드·HTTP 헤더·words 응답·실제 버킷.

## 완료 조건

- [ ] R2 hit에서는 제공자 0회, 정상 miss에서만 1회 호출된다.
- [ ] R2 예외·timeout·손상은 합성 0회로 실패한다.
- [ ] put 경합/실패/timeout·늦은 결과가 지정된 결과로 수렴하고 미처리 rejection이 없다.
- [ ] 전체 단계 예산·취소가 유지되며 저장 실패가 재합성을 유발하지 않는다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

저장소/provider/clock/작업 등록 더블로 서비스 조합을 검사한다. 일부 사례는 실제 storage·validateMp3를 결합해 포트 연결 오류를 검증한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §4·§6.1; PRD AC-08·AC-10·AC-13·AC-19~23.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
