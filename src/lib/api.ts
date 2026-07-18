/**
 * API 인증 클라이언트 + 엔드포인트 함수 (PRD §7.3·§8, design-prd §2). 모든
 * `/api/*` 호출은 반드시 apiFetch를 경유할 것 — 직접 fetch를 쓰면 Authorization
 * 첨부와 401 처리(저장값 삭제 + 로그인 화면 복귀)에서 빠진다.
 */

import type { QuizMode } from "./sessionQueue.ts";

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

/**
 * GET /api/words 응답의 단어 객체 (PRD §7.3). worker/lib/words.ts의 WordEntry와
 * 같은 형태지만, tsconfig.app.json이 src만 포함해 worker 타입을 import할 수 없어
 * 클라이언트 쪽 계약 미러로 둔다. wordState의 WordProgress·sessionQueue의
 * QueueWord 요구 필드와 구조적으로 호환된다.
 */
export interface WordEntry {
  tab: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  m1: number;
  m2: number;
  nextReview: string | null;
  interval: number | null;
}

/** GET /api/words — 전 탭 통합 단어 목록. 비정상 응답은 throw (홈이 에러 상태로 표시). */
export async function fetchWords(): Promise<WordEntry[]> {
  const response = await apiFetch("/api/words");
  if (!response.ok) {
    throw new Error(`GET /api/words 실패 (${response.status})`);
  }
  const body = (await response.json()) as { words: WordEntry[] };
  return body.words;
}

/** POST /api/answer 요청 바디 (PRD §7.3). timestamp는 판정 시각(YYYY-MM-DD HH:mm, Asia/Seoul). */
export interface AnswerRecord {
  tab: string;
  hanzi: string;
  mode: QuizMode;
  timestamp: string;
  isReview: boolean;
}

/**
 * POST /api/answer — 정답 1건 기록. 갱신된 단어 객체를 반환하고, 비정상 응답은
 * throw한다 — 셸이 catch로 무시해 진행을 막지 않는다(§6.2). 실패분 재전송은
 * 재시도 큐(#18)가 그 catch 지점에 배선될 예정.
 */
export async function postAnswer(answer: AnswerRecord): Promise<WordEntry> {
  const response = await apiFetch("/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answer),
  });
  if (!response.ok) {
    throw new Error(`POST /api/answer 실패 (${response.status})`);
  }
  return (await response.json()) as WordEntry;
}

/** POST /api/review-fail — 복습 오답의 간격 후퇴 (PRD §5.3). 실패 처리 방침은 postAnswer와 동일. */
export async function postReviewFail(tab: string, hanzi: string): Promise<WordEntry> {
  const response = await apiFetch("/api/review-fail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tab, hanzi }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/review-fail 실패 (${response.status})`);
  }
  return (await response.json()) as WordEntry;
}
