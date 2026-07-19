/**
 * 등록 화면 전용 API 클라이언트 — `GET /api/tabs`·`POST /api/words/register`
 * (단어 등록 시스템 플랜 §6, Worker 구현 #48 — worker/routes/tabs.ts·register.ts
 * 실측 계약 기준). 기존 wordsApi.ts/api.ts와 동일하게 apiFetch 경유 + 비정상
 * 응답 throw 패턴.
 *
 * POST 바디의 words는 registerValidation이 분류한 valid·duplicate 행만 담는다
 * (blocked 행은 애초에 전송하지 않음) — 시트 내 중복의 최종 스킵은 Worker
 * 책임(플랜 §2 신뢰 경계, worker/lib/register.ts의 partitionByExisting)이라,
 * duplicate로 표시된 행도 그대로 보내 Worker가 실제로 스킵하게 한다.
 *
 * 비정상 응답은 Worker가 내려주는 `{error: string}` 본문을 우선 사용한다 —
 * register 라우트는 탭 이름·스키마 위반마다 구체적인 한국어 사유를 내려주므로
 * (예: "헤더를 복사할 기존 탭이 없습니다"), HTTP 상태 코드만 보여주는 것보다
 * 사용자에게 더 유용하다. 본문이 JSON이 아니거나 error 필드가 없으면 폴백.
 */

import { apiFetch } from "./api.ts";
import type { ParsedWord } from "./registerValidation.ts";

async function extractErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") return body.error;
  } catch {
    // 본문이 JSON이 아니면 폴백 메시지를 그대로 쓴다.
  }
  return fallback;
}

export async function fetchTabs(signal?: AbortSignal): Promise<string[]> {
  const response = await apiFetch("/api/tabs", { signal });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, `탭 목록을 불러오지 못했습니다 (HTTP ${response.status})`));
  }
  const data = (await response.json()) as { tabs: string[] };
  return data.tabs;
}

export interface RegisterRequest {
  tab: string;
  createTab?: boolean;
  words: ParsedWord[];
}

/** worker/routes/register.ts 응답 실측 계약: added는 등록된 단어 전체 객체, skipped는 스킵된 한자 문자열. */
export interface RegisterResult {
  tab: string;
  created: boolean;
  added: ParsedWord[];
  skipped: string[];
}

export async function registerWords(request: RegisterRequest): Promise<RegisterResult> {
  const response = await apiFetch("/api/words/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, `POST /api/words/register 실패 (${response.status})`));
  }
  return (await response.json()) as RegisterResult;
}
