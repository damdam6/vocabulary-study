# [TTS-06] 인증된 중국어 음성 API와 기능 활성 정보를 제공한다

> **17개 재편판**의 등록용 초안이다. 첫 줄을 제목으로, 이후 내용을 본문으로 사용한다. 실제 GitHub 번호는 미등록이며 이전 11개 초안과의 대응은 [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md#8-이전-초안과의-대응)를 따른다.

## 의존성

직접 선행 이슈: **TTS-05**. 모든 선행 결과가 머지되어야 한다(AND).
등록 시 임시 ID를 실제 `#이슈번호`로 바꾼다. 범위 크기: M. 이전 05의 HTTP 경계에서 재편했다.

## 공통 실행 조건

- 저장소 `damdam6/vocabulary-study`. 출발점·PR base·머지 대상은 **`feat/ch-sound`**다. 선행 이슈가 이 베이스에 머지된 뒤 최신 상태에서 시작한다.
- 제공자·모델은 **QwenCloud / `qwen-audio-3.0-tts-flash`**로 확정했다. 기본 음색 `longanfengyue`, 속도 1.0, 국제 DashScope endpoint를 쓴다. API 키 발급은 완료됐으며 시크릿 이름은 `DASHSCOPE_API_KEY`다. 실제 주입·접근은 미검증이고 키 원문은 문서·코드·로그에 넣지 않는다.
- 인증된 `contentType === "zh"`만 지원한다. 모드1 플립 완료·모드2 오답 결과에서 자동 1회 시도와 수동 반복 재생을 제공한다. generic·모드2 정답은 음성 요청이 없다.
- 첫 요청에 생성한 MP3를 비공개 R2에 지속 저장한다. R2 조회 실패는 재합성하지 않고 저장만 실패하면 생성 음성을 반환한다. 선생성·전체 배치·Cache API·자동 삭제는 이번 범위 밖이다.
- A열 원문만 합성한다. B열은 표시·저장 키에 유지하고 `absent` 또는 `ignored`로 진단한다. 강제 병음·SSML·hot_fix·다른 모델로의 자동 전환은 사용하지 않는다.
- 음성 작업이 채점·진행·시트 기록을 막지 않으며 TTS를 학습 재시도 큐에 넣지 않는다. 출시 확인 전 운영 `TTS_ENABLED=false`를 유지한다.
- [PRD](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/PRD-chinese-tts-audio.md)·[아키텍처](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/architecture/chinese-tts-audio.md)의 구현 계약을 따른다. 각 이슈는 소유 모듈의 정상·실패 처리와 의미 있는 테스트까지 완료한다. 아래 범위 밖 구현을 선행해서 가져오지 않는다.

## 현상 / 배경

완성된 서비스에 기존 프로필 인증과 안정적인 HTTP 계약을 연결해야 한다.

## 기대 동작

1. 기존 resolveProfile 블록 안에 POST /api/tts를 등록한다. 메서드·zh·설정·본문 검증 후 TTS-05 서비스에 전달한다.
2. 성공 MP3와 source/storage/pronunciation/revision 헤더, private,no-store·nosniff를 응답한다. 서비스 결과의 HTTP 직렬화만 담당한다.
3. 401의 기존 빈 본문·apiFetch 계약을 유지하고 provider 인증 오류는 503으로 응답한다. 모든 TTS 실패를 안정적인 코드·한국어 메시지로 반환한다.
4. ExecutionContext를 전달하고 서비스의 작업 등록 함수를 ctx.waitUntil에 연결한다. 기존 worker.fetch 호출 테스트 더블을 함께 갱신한다.
5. words에 optional tts capability를 추가한다. generic·TTS 미설정은 off여도 words가 정상이고 health/PROFILES 계약은 유지한다. 로그에는 허용된 진단 필드만 남긴다.

## 변경 대상과 소유 경계

- `worker/routes/tts.ts`
- `worker/index.ts`
- `worker/routes/words.ts`
- `worker/test-utils.ts`

해당 모듈의 테스트와 필요한 전용 fixture를 함께 소유한다. 예정 경로는 새로 생성할 수 있다. **범위 밖:** 서비스 정책·adapter·저장소 재구현, 프론트 전달, Wrangler 설정.

## 완료 조건

- [ ] 미인증/generic/disabled/잘못된 요청은 서비스·R2·provider 전에 종료된다.
- [ ] 성공의 세 헤더 조합과 모든 오류 코드가 PRD와 일치하며 객체 키·직접 URL은 노출하지 않는다.
- [ ] 앱 401과 provider 인증 오류를 구분하고 기존 health/words/학습 기록 API가 유지된다.
- [ ] 실제 서비스와 연결한 대표 요청에서 waitUntil·취소가 전달되고 Sheets를 추가 호출하지 않는다.
- [ ] 소유 범위의 구현·테스트·관련 계약을 함께 완료하고 미검증 항목을 표시한다.
- [ ] `feat/ch-sound`를 PR base로 사용하고 변경 범위·검증 결과를 기록한다.

## 검증

Worker HTTP 테스트로 인증·메서드·capability·응답·작업 등록을 확인한다. 서비스 내부 경합 조합은 TTS-05 테스트를 재사용한다.

개발 중 관련 테스트를 실행하고 이슈 완료 시 `npm test`, `npm run lint`, `npm run build`를 확인한다. 실제 키·청취·모바일·R2 접근 검증을 더블 통과로 대신하지 않는다.

## 사양 추적

아키텍처 §3~4·§9; PRD AC-01·AC-10·AC-14·AC-18·AC-24.

자동 실행의 전체 순서·파일 소유·수용 기준 대응: [태스크 지도](https://github.com/damdam6/vocabulary-study/blob/feat/ch-sound/docs/plans/chinese-tts-audio-tasks.md).
