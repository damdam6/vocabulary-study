/**
 * API 인증 클라이언트 (PRD §8, design-prd §2). 모든 `/api/*` 호출은 반드시
 * apiFetch를 경유할 것 — 직접 fetch를 쓰면 Authorization 첨부와 401 처리(저장값
 * 삭제 + 로그인 화면 복귀)에서 빠진다.
 */

const STORAGE_KEY = "app-password";

export function getStoredPassword(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function savePassword(password: string): void {
  localStorage.setItem(STORAGE_KEY, password);
}

export function clearPassword(): void {
  localStorage.removeItem(STORAGE_KEY);
}

let unauthorizedHandler: (() => void) | null = null;

/** 401 수신 시(저장값 삭제 후) 호출될 핸들러 등록. App이 로그인 화면 복귀에 사용한다. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/** 저장된 비밀번호를 Bearer로 첨부해 fetch. 401이면 저장값을 지우고 핸들러를 호출한 뒤 응답을 그대로 반환한다. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const password = getStoredPassword();
  if (password !== null) {
    headers.set("Authorization", `Bearer ${password}`);
  }
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    clearPassword();
    unauthorizedHandler?.();
  }
  return response;
}

export type VerifyResult = "ok" | "invalid" | "error";

/**
 * 후보 비밀번호를 Bearer로 GET /api/health 호출해 검증한다 (design-prd §2).
 * 아직 저장 전 값이므로 apiFetch를 경유하지 않는다. 401(오답)과 네트워크·서버
 * 오류를 구분해 반환한다 — 일시 장애를 오답으로 표시하지 않기 위함.
 */
export async function verifyPassword(candidate: string): Promise<VerifyResult> {
  try {
    const response = await fetch("/api/health", {
      headers: { Authorization: `Bearer ${candidate}` },
    });
    if (response.ok) return "ok";
    if (response.status === 401) return "invalid";
    return "error";
  } catch {
    return "error";
  }
}
