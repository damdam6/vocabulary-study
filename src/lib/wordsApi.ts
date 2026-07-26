/**
 * `GET /api/words` 클라이언트 — 홈 화면 현황 집계(#13)·세션 큐 구성(#14)·학습
 * 화면 출제(#15)가 공유하는 단어 목록 조회. 응답 형태는 worker/routes/words.ts 참고.
 * words의 반환 타입은 전체 필드의 WordEntry(§7.3 계약 미러) — 집계는 그 부분집합인
 * WordProgress로 구조적으로 받아들이고, 학습 화면은 한자·병음·뜻까지 쓴다. profile은
 * 홈이 진입마다 재조회하는 최신 프로필 원천이다(PRD-general §5.2·§7) — 캐시 갱신은
 * 호출부 책임(#78).
 */

import { apiFetch, type PublicProfile, type WordEntry } from "./api.ts";

export interface WordsResponse {
  profile: PublicProfile;
  words: WordEntry[];
}

export async function fetchWords(signal?: AbortSignal): Promise<WordsResponse> {
  const response = await apiFetch("/api/words", { signal });
  if (!response.ok) {
    throw new Error(`단어 목록을 불러오지 못했습니다 (HTTP ${response.status})`);
  }
  // 서버 응답에는 fetchedAt도 실려 있지만(worker/routes/words.ts), 쓰는 곳이 없어 골라내지 않고 버린다.
  const data = (await response.json()) as WordsResponse;
  return { profile: data.profile, words: data.words };
}
