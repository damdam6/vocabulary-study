#!/usr/bin/env bash
# 배포 직후 /api/health 인증 스모크 테스트 (#23)
#
# 배포 전파 윈도우 동안 틀린 토큰·무헤더 요청이 401 외의 응답을 받는지 감시한다.
# 응답의 X-Worker-Version 헤더를 함께 기록하므로, 신/구 버전 혼재가 일어나면
# 로그에서 버전 값이 섞여 나오는 것으로 직접 관측된다.
#
# 사용법:
#   scripts/deploy-auth-smoke.sh <BASE_URL> [지속시간(초, 기본 60)]
#   SMOKE_PASSWORD=<비밀번호>  # 설정 시 정상 토큰 → 200 경로도 함께 확인
#
# 종료 코드: 위반(틀린/무헤더 → 非401, 정상 토큰 → 非200)이 하나라도 있으면 1.
set -eu

BASE_URL="${1:?사용법: $0 <BASE_URL> [지속시간(초, 기본 60)]}"
DURATION="${2:-60}"
WRONG_TOKEN="smoke-clearly-wrong-token-$$"

probe() { # $1: 모드(wrong|none|correct)
  local url="$BASE_URL/api/health?smoke=$RANDOM"
  local headers status version expected
  case "$1" in
    wrong)   headers=$(curl -sS -D - -o /dev/null --max-time 5 \
               -H "Authorization: Bearer $WRONG_TOKEN" "$url" || true); expected=401 ;;
    none)    headers=$(curl -sS -D - -o /dev/null --max-time 5 "$url" || true); expected=401 ;;
    correct) headers=$(curl -sS -D - -o /dev/null --max-time 5 \
               -H "Authorization: Bearer $SMOKE_PASSWORD" "$url" || true); expected=200 ;;
  esac
  status=$(printf '%s' "$headers" | head -1 | awk '{print $2}')
  version=$(printf '%s' "$headers" | tr -d '\r' \
    | awk -F': ' 'tolower($1)=="x-worker-version"{print $2}')
  printf '%s  %-7s  status=%-3s  version=%s\n' \
    "$(date +%H:%M:%S)" "$1" "${status:-ERR}" "${version:-<none>}"
  if [ "${status:-ERR}" != "$expected" ]; then
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
}

VIOLATIONS=0
TOTAL=0
START=$SECONDS
echo "== 인증 스모크 시작: $BASE_URL (${DURATION}s) =="
while [ $((SECONDS - START)) -lt "$DURATION" ]; do
  probe wrong;  TOTAL=$((TOTAL + 1))
  probe none;   TOTAL=$((TOTAL + 1))
  if [ -n "${SMOKE_PASSWORD:-}" ]; then
    probe correct; TOTAL=$((TOTAL + 1))
  fi
  sleep 0.3
done

echo "== 완료: 요청 ${TOTAL}건, 위반 ${VIOLATIONS}건 =="
[ "$VIOLATIONS" -eq 0 ] || exit 1
