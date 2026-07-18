/**
 * 기능 PRD §7.2/§8: `APP_PASSWORD` 저장·조회. 로그인 화면(#11)이 아직 없어
 * 홈 화면(#13)이 이 계약을 처음 정의한다 — #11은 이 함수들을 그대로 재사용한다.
 */

const STORAGE_KEY = "vocab-study:app-password";

export function getStoredPassword(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredPassword(password: string): void {
  localStorage.setItem(STORAGE_KEY, password);
}

export function clearStoredPassword(): void {
  localStorage.removeItem(STORAGE_KEY);
}
