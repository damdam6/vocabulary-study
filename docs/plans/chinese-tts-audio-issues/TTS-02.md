# [TTS-02] 중국어 MP3의 비공개 R2 조회·조건부 저장을 구현한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-01**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: M. 이전 03에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

저장 파일을 재사용하고 동시 최초 생성이 기존 MP3를 덮어쓰지 않도록 저장 경계를 구현한다.

## 기대 동작

1. R2Bucket과 validateAudio 함수를 주입받는 저장 모듈을 만든다. 파일 있음/null/조회 예외/손상을 구분한다. MP3 검사는 주입 함수에 위임하고 별도 파서를 만들지 않는다.
2. audio/v1/{profilePartition}/{revision}/{digest}.mp3를 만든다. 인증 프로필/시트, text/pinyin, provider/region/model/voice/rate/audioSettings/adapterVersion/pinyin-none-v1/revision을 안정적 튜플로 해시한다.
3. R2 파일의 MIME·크기·바이트를 검사하고 정상 get null만 미존재로 반환한다. 힌트가 없어도 B열 변경은 키를 바꾼다.
4. If-None-Match: * 조건부 put으로 성공/경합/실패를 구분한다. 비밀·원문·병음·시트 ID를 메타데이터에 넣지 않는다.
5. 조회·put·재조회의 원래 Promise를 호출부가 관측할 수 있게 한다. 2초 deadline·경합 재조회·waitUntil·HTTP 결과 결정은 TTS-05가 소유한다. TTL·자동 삭제는 추가하지 않는다.

## 변경 대상과 소유 경계

- `worker/lib/tts/storage.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 외부 합성, HTTP·ExecutionContext 정책, 버킷 생성·실제 파일 삭제.

## 완료 조건

- [ ] 같은 입력의 키는 세션·기기와 무관하며 프로필/시트/B열/설정 변경은 키를 바꾼다.
- [ ] 조회 실패·손상을 null로 축약하지 않고 검사기 실패를 전달한다.
- [ ] 경합 시 기존 객체를 덮어쓰지 않으며 저장 성공/경합/실패를 구별한다.
- [ ] 대기 종료 후에도 원래 저장 Promise를 호출부가 회수할 수 있다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

R2와 validateAudio 더블로 조회·손상·조건부 put·실패·늦은 완료를 검증한다. 실제 MP3 검사 연결은 TTS-05에서 확인한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §6.1~6.2; PRD AC-12·AC-13·AC-19~24.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
