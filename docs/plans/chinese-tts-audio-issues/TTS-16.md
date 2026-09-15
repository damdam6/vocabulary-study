# [TTS-16] 중국어 음성 기능의 대표 통합 흐름과 학습 회귀를 검증한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-06, TTS-13, TTS-14**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: M. 이전 11에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

모듈별 상세 실패 검증이 끝난 뒤 연결에서 깨질 수 있는 대표 흐름과 기존 학습을 확인한다. 실제 R2/키 준비는 선행 조건이 아니다.

## 기대 동작

1. 최초 합성→조건부 저장→새 세션의 같은 바이트 재사용을 실제 서비스/라우트 연결과 R2/provider 더블로 검증한다.
2. 대표 장애는 R2 조회 실패의 합성 0회, 저장 실패의 UNCONFIRMED 재생, provider 인증 오류의 앱 인증 유지로 한정한다. 세부 protocol·경합·timeout 조합은 각 소유 이슈의 테스트를 증거로 연결한다.
3. 모드1 공개·빠른 판정, 모드2 빈 오답·즉시 정답, 로그인 복귀·hidden에서 실제 세션/controller 연결을 검사한다.
4. 동일 판정 시나리오의 채점·큐·기록·통계를 TTS 정상/실패/off와 비교한다. 개정 AC-12의 병음 입력 분리·키 변경은 선행 테스트 증거를 연결한다.
5. AC-01~24의 자동 테스트 경로와 결과를 매핑한다. 실제 청취·모바일·R2·지연은 출시 미검증으로 기록한다. 대표 연결 결함만 수정하며 범위를 넘는 재설계는 발견 사항으로 명시한다.

## 변경 대상과 소유 경계

- `worker/tts.integration.test.ts`
- `src/screens/StudyScreen.tts.integration.test.tsx`
- `docs/plans/chinese-tts-audio-verification.md`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 실제 환경 연결(TTS-15), 청취·모바일 실측·배포, 무제한 전체 기능 재구현.

## 완료 조건

- [ ] 대표 저장·장애·카드 공개·세션 종료 연결과 기존 학습 회귀가 통과한다.
- [ ] 각 AC에 실행 증거 또는 출시 확인 항목이 있고 상세 단위 테스트를 복제하지 않는다.
- [ ] 실제 키·버킷·운영 배포 없이 자동 테스트를 실행할 수 있다.
- [ ] 전체 test/lint/build 결과와 확인되지 않은 출시 항목을 기록한다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

기존 Vitest node/jsdom을 사용한다. test/lint/build를 실행하고 새 연결 결함은 관련 검증 후 재확인한다. 실기기 청취를 더블 통과로 보고하지 않는다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §11; PRD AC-01~24의 최종 자동 증거.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
