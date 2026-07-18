/**
 * `GET /api/words` 클라이언트 — 홈 화면 현황 집계(#13)·세션 큐 구성(#14)이
 * 공유하는 단어 목록 조회. 응답 형태는 worker/routes/words.ts 참고.
 */

import { apiFetch } from "./api.ts";
import type { WordProgress } from "./wordState.ts";

export async function fetchWords(signal?: AbortSignal): Promise<WordProgress[]> {
  const response = await apiFetch("/api/words", { signal });
  if (!response.ok) {
    throw new Error(`단어 목록을 불러오지 못했습니다 (HTTP ${response.status})`);
  }
  const data = (await response.json()) as { words: WordProgress[] };
  return data.words;
}
