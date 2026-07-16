/**
 * `/api/*` 요청 인증 — Authorization: Bearer <APP_PASSWORD> 헤더 검사.
 */

export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD) {
    return false;
  }
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return false;
  }
  const token = header.substring("Bearer ".length);
  return timingSafeEqualString(token, env.APP_PASSWORD);
}

// 두 문자열을 고정 길이(SHA-256) 해시로 변환한 뒤 상수 시간으로 비교한다.
// 원본 길이·내용에 따라 비교 시간이 달라지는 것을 막아 타이밍 공격 표면을 없앤다.
async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < digestA.length; i++) {
    diff |= digestA[i] ^ digestB[i];
  }
  return diff === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}
