/**
 * 등록 화면 전용 API 클라이언트 — `GET /api/tabs`·`POST /api/words/register`
 * (단어 등록 시스템 플랜 §6, Worker 구현은 #48). #48 머지 전까지 로컬 왕복은
 * 404이지만, 계약은 플랜 문서가 확정한 형태를 그대로 따른다. 기존
 * wordsApi.ts/api.ts와 동일하게 apiFetch 경유 + 비정상 응답 throw 패턴.
 *
 * POST 바디의 words는 registerValidation이 분류한 valid·duplicate 행만 담는다
 * (blocked 행은 애초에 전송하지 않음) — 시트 내 중복의 최종 스킵은 Worker
 * 책임(플랜 §2 신뢰 경계, #48 "탭 내 A열 중복 한자는 스킵")이라, duplicate로
 * 표시된 행도 그대로 보내 Worker가 실제로 스킵하게 한다.
 */

import { apiFetch } from "./api.ts";
import type { ParsedWord } from "./registerValidation.ts";

export async function fetchTabs(signal?: AbortSignal): Promise<string[]> {
  const response = await apiFetch("/api/tabs", { signal });
  if (!response.ok) {
    throw new Error(`탭 목록을 불러오지 못했습니다 (HTTP ${response.status})`);
  }
  const data = (await response.json()) as { tabs: string[] };
  return data.tabs;
}

export interface RegisterRequest {
  tab: string;
  createTab?: boolean;
  words: ParsedWord[];
}

export interface RegisterResult {
  added: string[];
  skipped: string[];
}

export async function registerWords(request: RegisterRequest): Promise<RegisterResult> {
  const response = await apiFetch("/api/words/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`POST /api/words/register 실패 (${response.status})`);
  }
  return (await response.json()) as RegisterResult;
}
