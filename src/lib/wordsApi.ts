/**
 * `GET /api/words` 클라이언트 — 홈 화면 현황 집계(#13)·세션 큐 구성(#14)·학습
 * 화면 출제(#15)가 공유하는 단어 목록 조회. 응답 형태는 worker/routes/words.ts 참고.
 * 반환 타입은 전체 필드의 WordEntry(§7.3 계약 미러) — 집계는 그 부분집합인
 * WordProgress로 구조적으로 받아들이고, 학습 화면은 한자·병음·뜻까지 쓴다.
 */

import { apiFetch, type WordEntry } from "./api.ts";

export async function fetchWords(signal?: AbortSignal): Promise<WordEntry[]> {
  const response = await apiFetch("/api/words", { signal });
  if (!response.ok) {
    throw new Error(`단어 목록을 불러오지 못했습니다 (HTTP ${response.status})`);
  }
  const data = (await response.json()) as { words: WordEntry[] };
  return data.words;
}
