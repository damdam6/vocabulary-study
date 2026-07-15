/**
 * `/api/*` 요청 인증 — Authorization: Bearer <APP_PASSWORD> 헤더 검사.
 */

export function isAuthorized(request: Request, env: Env): boolean {
  if (!env.APP_PASSWORD) {
    return false;
  }
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return false;
  }
  const token = header.substring("Bearer ".length);
  return token === env.APP_PASSWORD;
}
