# 중국어 TTS 환경 준비 기록

> 최종 확인일: 2026-09-17 · 대상 Worker: `vocabulary-study` · Cloudflare 계정: `Dambi626626@gmail.com's Account` · 운영 기능 플래그: `TTS_ENABLED="false"`

이 문서는 TTS 환경 연결의 비밀이 아닌 상태만 기록한다. API 키 값, Cloudflare 인증 토큰, R2 객체 내용은 기록하거나 확인하지 않는다. 타입 생성과 로컬 테스트는 실제 버킷 존재·권한·시크릿 접근을 증명하지 않는다.

## 고정 Worker 설정

| 설정 | 값 | 상태 |
|---|---|---|
| `TTS_ENABLED` | `false` | 추적 설정에 명시 |
| `TTS_PROVIDER` | `qwen` | 추적 설정에 명시 |
| `TTS_MODEL` | `qwen-audio-3.0-tts-flash` | 추적 설정에 명시 |
| `TTS_VOICE` | `longanfengyue` | 추적 설정에 명시, 실제 청취 미검증 |
| `TTS_RATE` | `1.0` | 추적 설정에 명시 |
| `TTS_REVISION` | `tts-v1` | 추적 설정에 명시 |

## R2 준비 상태

| 환경 역할 | 실제 버킷 식별자 | Worker 매핑 | 저장 등급 | 비공개 상태 | 공개 도메인 / `r2.dev` | 자동 만료 lifecycle | 객체 접근 |
|---|---|---|---|---|---|---|---|
| 운영 | `vocabulary-study-tts-audio` | `TTS_AUDIO`의 `bucket_name` | Standard 확인 | 비공개 확인 | 없음 / 비활성 확인 | 객체 자동 만료 없음 확인¹ | 객체 접근 미검증 |
| 개발/테스트 | `audio-uploads` | `TTS_AUDIO`의 `preview_bucket_name` | Standard 확인 | 비공개 확인 | 없음 / 비활성 확인 | 객체 자동 만료 없음 확인¹ | 객체 접근 미검증 |

2026-09-17 사용자가 기존 `audio-uploads`를 개발/테스트용으로, `vocabulary-study-tts-audio`를 운영용으로 명시적으로 확정했다. 프로젝트 Wrangler 4.110.0으로 운영 버킷을 APAC·Standard로 생성한 이력이 있으며, 두 버킷의 info/domain/dev-url/lifecycle 메타데이터를 읽기 전용으로 확인했다. 두 버킷 모두 custom domain이 없고 `r2.dev`가 비활성이다. R2 객체를 list/get/put하지 않았으며 기존 `audio-uploads`의 객체 내용도 읽지 않았다.

¹ 두 버킷에는 미완료 multipart upload를 7일 뒤 중단하는 Cloudflare 기본 규칙만 있다. 완성된 객체를 만료·삭제하는 lifecycle 규칙은 없다.

## DashScope 시크릿과 접근 상태

| 환경 역할 | 키 발급 | `DASHSCOPE_API_KEY` 주입 | 국제 endpoint 접근 | 모델 접근 | 유료 합성 / 청취 |
|---|---|---|---|---|---|
| 운영 | 완료(소유자 제공 상태) | 미주입 확인 (`wrangler secret list`에 이름 없음) | 미검증 | 미검증 | 미실행 |
| 개발/테스트 | 완료(동일 발급 사실만 확인) | 별도 named Worker 환경 없음, 실제 주입 미확인 | 미검증 | 미검증 | 미실행 |

키 발급 완료는 환경별 secret 주입이나 실제 접근 성공을 뜻하지 않는다. 2026-09-17 배포된 `vocabulary-study` Worker의 secret 이름 목록에는 `APP_PASSWORD`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `PROFILES`만 있었고 `DASHSCOPE_API_KEY`는 없었다. 값은 조회하지 않았다. 이번 작업에서는 secret 값이나 실제 환경/자격 증명 파일을 읽지 않았고, 배포·유료 TTS 호출도 수행하지 않았다.

## 출시 전에 필요한 후속 확인

1. 운영 Worker에 `DASHSCOPE_API_KEY`를 주입하고 국제 endpoint/모델 접근을 별도로 확인한다. 값은 제공하거나 기록하지 않는다. 2026-09-17 일반 `wrangler secret put`은 최신 Worker 버전이 배포되지 않아 거부됐으며, 배포 없는 `wrangler versions secret put` 또는 향후 배포 절차에서 처리해야 한다.
2. 개발/테스트에서 사용할 실제 secret 주입 방식을 확정하고 주입 상태를 확인한다.
3. 배포된 Worker의 최종 `TTS_AUDIO` binding과 실제 접근 확인 상태. 객체 접근 자체는 별도 승인된 출시 검증에서 수행한다.

단일 `TTS_AUDIO` 항목에 운영 `bucket_name`과 검증 `preview_bucket_name`을 연결했다. `TTS_ENABLED`는 출시 확인 전 계속 `false`로 둔다.

## 검증 경계와 후속 작업

- 로컬 타입 생성은 실제 secret 파일을 읽지 않고, git에서 제외된 `.issue-codex/tts-typegen.synthetic.env`에 이미 공개된 `GOOGLE_SERVICE_ACCOUNT_KEY`·`PROFILES` 이름과 명백한 가짜 값만 넣어 `npm run cf-typegen -- --env-file .issue-codex/tts-typegen.synthetic.env`로 수행했다. 이는 Wrangler 4.110.0의 지원되는 `--env-file` 입력이며 배포 secret이나 생산 설정을 변경하지 않는다.
- 로컬 typegen/test/lint/build는 설정 형태와 회귀만 검증한다.
- 실제 R2 객체 read/write, Qwen 모델 접근, MP3 청취, 모바일 자동재생, 실제 지연, 배포는 미검증이다.
- TTS-16(#150)의 자동 통합 회귀는 더블을 사용하므로 이 환경 입력을 기다리지 않고 독립적으로 진행한다.
- 위 항목은 #149의 설정 PR 완료를 막지 않는 출시 후속 확인이다. TTS-17(#151)은 이 상태를 그대로 인계하며 미검증 항목을 출시 완료로 바꾸지 않는다.
