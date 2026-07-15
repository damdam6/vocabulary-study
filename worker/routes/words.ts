/**
 * GET /api/words — `_` 접두 탭을 제외한 전 탭의 단어를 하나의 배열로 통합해 반환.
 * 큐 구성·상태 판정(PRD 5.1, 6.1)은 클라이언트 책임 — 여기는 데이터 중계·정규화만 한다.
 */

import { formatSeoulDateTime } from "../lib/time.ts";
import { getSheetTitles, getValues } from "../lib/sheets.ts";
import { parseWordRow, WORD_ROW_RANGE, type WordEntry } from "../lib/words.ts";

export async function handleGetWords(env: Env): Promise<Response> {
  const titles = await getSheetTitles(env);
  const wordTabs = titles.filter((title) => !title.startsWith("_"));

  const rowsByTab = await Promise.all(
    wordTabs.map((tab) => getValues(env, tab, WORD_ROW_RANGE)),
  );

  const words: WordEntry[] = [];
  wordTabs.forEach((tab, i) => {
    for (const row of rowsByTab[i]) {
      words.push(parseWordRow(tab, row));
    }
  });

  return Response.json({ fetchedAt: formatSeoulDateTime(new Date()), words });
}
