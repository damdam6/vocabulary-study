# 중국어 TTS 운영·출시 런북

> 문서화 기준: 2026-09-17 · 대상: `feat/ch-sound`의 중국어 TTS 구현
>
> 이 문서는 비밀값을 요구하거나 실제 배포를 수행하지 않는다. 현재 baseline은 `TTS_ENABLED=false`이며, 아래의 미완료 표시는 출시 완료가 아니다.

## 1. 사실 기록과 범위

- 운영 R2는 `vocabulary-study-tts-audio`, 개발·테스트 R2는 기존 `audio-uploads`다. 둘 다 `TTS_AUDIO`의 운영/preview binding에 매핑된 Standard·private bucket이며 custom domain과 `r2.dev`는 사용하지 않는다. 완성 객체 자동 만료 lifecycle도 없다. 자세한 관찰 범위는 [환경 준비 기록](chinese-tts-audio-environment.md)을 따른다.
- 구현은 인증된 `contentType === "zh"` 프로필만 TTS를 노출한다. `/api/words` capability가 `{ enabled, revision, maxTextLength: 200 }`이 아니면 버튼을 표시하지 않고 학습은 계속한다.
- `/api/tts`는 A열 표제어만 합성한다. B열 병음은 표시와 객체 키에 사용되지만 provider hint에는 넣지 않는다. B열 없음은 `absent`, 값이 있어도 첫 버전 정책에서는 `ignored`다.
- 첫 범위에는 선생성·배치·강제 병음·SSML·`hot_fix`·자동 provider fallback·자동 object 삭제를 넣지 않는다. TTS는 채점·진행·시트 기록을 막지 않고 retryQueue에도 넣지 않는다.

선행 증거는 [#149 환경 기록](chinese-tts-audio-environment.md)과 [#150 자동 검증 기록](chinese-tts-audio-verification.md)이다. #150의 4 files/32 tests, 55 files/696 tests, lint/build 통과는 선행 동일 HEAD의 자동 증거이며 실제 R2·provider·청취·모바일 검증을 뜻하지 않는다.

## 2. 출시 전 baseline

다음 상태를 읽기 전용으로 확인하고 기록한다.

| 확인 항목 | 현재 기록 | 출시 판정 |
|---|---|---|
| `TTS_ENABLED` | `false` 유지 | 미완료 |
| 운영 bucket | `vocabulary-study-tts-audio`, private/Standard | 설정 관찰 완료, 객체 접근 미검증 |
| 개발·테스트 bucket | `audio-uploads`, private/Standard | 설정 관찰 완료, 객체 접근 미검증 |
| `DASHSCOPE_API_KEY` 발급 | 소유자 발급 사실만 확인 | 주입·접근과 별도 |
| secret 주입 | 환경별 미확정/미검증 | 미완료 |
| 국제 endpoint/model 접근 | 미검증 | 미완료 |

키 원문·토큰·R2 객체 바이트·secret 값은 읽거나 로그/문서에 복사하지 않는다. `TTS_ENABLED`를 바꾸거나 bucket, lifecycle, secret을 이 문서 작업에서 변경하지 않는다.

## 3. Secret 수명과 배포 상태를 분리한다

운영 담당은 다음 네 상태를 각각 확인한다.

1. **키 발급**: DashScope 계정에서 키가 발급됐다는 사실. 이것만으로 Worker가 사용할 수 있다고 말하지 않는다.
2. **staged version**: 버전 지정 명령을 선택할 때 `wrangler versions secret put`은 secret을 해당 version에 넣지만 version을 배포하지 않는다. 생성된 version 식별자만 비밀 없이 기록한다.
3. **명시적 deployment**: `wrangler versions deploy` 등 승인된 배포 절차로 staged version을 실제 Worker에 배포한다. 배포 로그의 secret 값은 출력하지 않는다.
4. **실제 접근**: 배포된 Worker의 secret 이름이 `DASHSCOPE_API_KEY`인지, 국제 endpoint와 `qwen-audio-3.0-tts-flash` 호출이 성공하는지를 인증된 `zh` 요청으로 별도로 확인한다.

일반 `wrangler secret put`은 새 Worker version을 만들고 즉시 배포하는 의미이므로 staged 절차와 혼동하지 않는다. 프로젝트에서 확인한 Wrangler는 4.110.0이다. 실제 명령 실행·키 입력·배포는 이 문서 PR의 작업이 아니다.

## 4. 기능 활성화 후의 안전한 확인 순서

활성화는 별도 승인된 출시 작업에서만 한다.

1. 검증 환경에서 `TTS_ENABLED`와 전체 설정 tuple을 확인한다. 기본 tuple은 provider `qwen`, model `qwen-audio-3.0-tts-flash`, voice `longanfengyue`, rate `1.0`, revision `tts-v1`, region `intl`, output `mp3`, adapter `qwen-ws-v1`, pronunciation policy `pinyin-none-v1`, audio settings `[24000,128,50,1,0,["zh"],false,null]`이다.
2. 인증된 `zh` 프로필의 200 코드 포인트 이하 표제어로 `/api/words` capability를 확인한다. `generic` 프로필, 미인증 요청, 기능 off에서는 capability/버튼/R2/provider 요청이 없어야 한다. AC-01/14의 직접 route 검증은 [`worker/routes/tts.test.ts`](../../worker/routes/tts.test.ts)의 parameterized validation 증거다.
3. 모드1은 공개 완료 뒤, 모드2는 오답 결과 DOM 반영 뒤 자동 1회 시도를 확인한다. 모드2 정답과 `generic`에는 요청이 없어야 하며, 판정·다음·기록은 음성을 기다리지 않아야 한다.
4. 응답이 MP3인지와 `Cache-Control: private, no-store`, `X-TTS-Source`, `X-TTS-Storage`, `X-TTS-Pronunciation`, `X-TTS-Revision`을 확인한다. `task-finished`와 유효한 MP3 조립 전의 provider 이벤트는 성공으로 세지 않는다.

## 5. 저장·재사용 확인

첫 요청이 `GENERATED/SAVED`이면 동일 profile·sheet·revision·설정·정규화 text/pinyin으로 저장된 객체를 의미한다. 새 수명 또는 다른 기기에서 같은 표제어를 재요청해 다음을 확인한다.

- 응답은 `STORED/PRESENT`이고 MP3 바이트가 최초 응답과 동일하다.
- provider 합성 호출과 추가 put이 없다.
- 다른 프로필은 별도 profile partition을 사용하며 private bucket URL로 직접 접근할 수 없다.

R2 조회 실패는 재합성하지 않고 TTS 저장소 오류로 처리한다. 객체가 없을 때만 합성한다. 실제 object read/write·profile isolation·다른 기기 재사용은 현재 미검증 출시 항목이다.

## 6. `UNCONFIRMED` 해석

`GENERATED/UNCONFIRMED`는 foreground에서 검증된 MP3를 반환했지만 2초 저장 대기 안에 put 성공을 확정하지 못했다는 뜻이다. 저장 성공도 저장 실패도 아니다.

1. 해당 응답의 MP3는 재생할 수 있고 같은 브라우저 세션 Blob은 재사용한다.
2. background task의 늦은 put 성공/실패를 관찰하되, 화면의 응답만으로 저장 상태를 덮어쓰지 않는다.
3. 다음 수명에서 R2를 다시 조회한다. `STORED/PRESENT`면 재사용하고, 없으면 새 요청에서 재합성한다.
4. 저장 실패만으로 학습 기록을 되돌리거나 retryQueue에 TTS 항목을 넣지 않는다.

## 7. 계량과 비용 대조

Qwen `task-finished` payload에 정수 `usage.characters`가 있을 때만 provider-reported billed characters로 보존한다. 원문 Unicode 코드 포인트 수는 입력 제한일 뿐 과금 문자 수가 아니며, public `/api/tts` 진단 header가 billing 값을 노출한다고 가정하지 않는다. 로그/telemetry에서 항상 확인된다고도 가정하지 않는다.

운영 시점에 다음 자료를 같은 기간·환경·revision으로 대조한다.

- provider event/internal result에 관찰된 `usage.characters` 합계
- provider 청구 화면 또는 export의 실제 계량
- R2 저장량·읽기·쓰기 자료와 revision별 보관량

무료량·단가·잔액은 공식 provider/R2 청구 자료를 확인하기 전까지 미확정으로 기록한다. 이 문서에는 고정 가격이나 무료 크레딧을 적지 않는다.

## 8. 롤백과 좁은 정리

- 가용성 장애는 `TTS_ENABLED=false`로 되돌려 새 TTS 조회·합성을 끈다. 기존 학습과 기록은 유지한다.
- 음질·모델·voice·rate·발음 정책 변경은 `TTS_REVISION`을 포함해 provider, region, model, voice, rate, output format, audio settings, adapter version, pronunciation policy의 **전체 tuple**을 함께 복원한다. revision만 바꾸거나 일부만 롤백해 다른 객체를 가리키지 않게 한다.
- 이전 revision 객체는 롤백을 위해 보존한다. 자동 lifecycle과 자동 삭제는 사용하지 않는다.
- 정리가 필요하면 먼저 현재 profile partition과 이전 revision prefix를 읽기 전용으로 확인하고, 승인된 좁은 대상·이유·승인자·실행 시각을 기록한 뒤 수동 정리한다. bucket 전체, profile 미확인 prefix, 현재 revision prefix를 대상으로 삭제하지 않는다. 삭제는 코드 롤백으로 복구되지 않는다.

## 9. 출시 gate

아래 항목은 그래프/자동 테스트 완료와 별도의 출시 확인이다.

- [ ] 운영·개발/테스트 secret 주입 및 deployed secret 이름
- [ ] 국제 endpoint와 실제 model 접근
- [ ] 실제 R2 object read/write, private object/profile isolation, stored reuse
- [ ] 20개 표본 청취 및 다음자·문장 품질
- [ ] iOS Safari·Android Chrome·desktop의 autoplay/hidden 복귀
- [ ] 준비된 음성·신규 합성 p95와 실제 로그 계량
- [ ] 승인된 활성화와 rollback rehearsal

이 gate가 남아 있어도 문서 PR의 완료는 제품/운영 계약과 미검증 경계를 정확히 기록하는 것으로 한정한다. 현재 `TTS_ENABLED=false`이며 이 문서 작성 중에는 cloud command, key 입력, 배포, 유료 합성, R2 list/get/put/delete를 실행하지 않았다.
