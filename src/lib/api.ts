/**
 * `/api/*` 공통 fetch 래퍼. 기능 PRD §7.2: 모든 요청에 `Authorization: Bearer
 * <APP_PASSWORD>` 필수. §8: 401 수신 시 저장된 비밀번호를 지운다(로그인 화면
 * 복귀는 #11 몫 — 화면 전환 로직이 없는 호출부는 이 세션 정리만 담당한다).
 */

import { clearStoredPassword, getStoredPassword } from "./auth.ts";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const password = getStoredPassword();
  const headers = new Headers(init?.headers);
  if (password) {
    headers.set("Authorization", `Bearer ${password}`);
  }

  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    clearStoredPassword();
  }
  return response;
}
