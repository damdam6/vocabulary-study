/**
 * `/api/*` 요청 인증 — Authorization: Bearer <APP_PASSWORD> 헤더 검사.
 */

export function isAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization");
  if (!header) {
    return false;
  }
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token === env.APP_PASSWORD;
}
