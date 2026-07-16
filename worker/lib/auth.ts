/**
 * `/api/*` 요청 인증 — Authorization: Bearer <APP_PASSWORD> 헤더 검사.
 */

// 비밀번호 해시는 isolate 수명 동안 바뀌지 않으므로 요청마다 재계산하지 않고 캐시한다.
let cachedPasswordDigest: Uint8Array | null = null;

export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD) {
    return false;
  }
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return false;
  }
  const token = header.substring("Bearer ".length);
  if (!cachedPasswordDigest) {
    cachedPasswordDigest = await sha256(env.APP_PASSWORD);
  }
  const tokenDigest = await sha256(token);
  return timingSafeEqual(tokenDigest, cachedPasswordDigest);
}

// 상수 시간(byte XOR) 비교. 두 다이제스트는 항상 SHA-256 고정 길이(32바이트)이므로
// 원본 길이·내용에 따른 타이밍 차이가 생기지 않는다.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}
