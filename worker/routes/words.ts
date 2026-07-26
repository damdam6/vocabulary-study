/**
 * GET /api/words — `_` 접두 탭을 제외한 전 탭의 단어를 하나의 배열로 통합해 반환.
 * 큐 구성·상태 판정(PRD 5.1, 6.1)은 클라이언트 책임 — 여기는 데이터 중계·정규화만 한다.
 * 응답 최상위 profile 블록이 모드 구성을 클라이언트로 전파하는 유일한 경로다 (PRD-general §5.2).
 */

import { formatSeoulDateTime } from "../lib/time.ts";
import { getValues } from "../lib/sheets.ts";
import { getWordTabTitles, parseWordRow, WORD_ROW_RANGE, type WordEntry } from "../lib/words.ts";
import { toPublicProfile, type Profile } from "../lib/profiles.ts";

export async function handleGetWords(
  _request: Request,
  env: Env,
  profile: Profile,
): Promise<Response> {
  const wordTabs = await getWordTabTitles(env, profile.sheetId);

  const rowsByTab = await Promise.all(
    wordTabs.map((tab) => getValues(env, profile.sheetId, tab, WORD_ROW_RANGE)),
  );

  const words: WordEntry[] = [];
  wordTabs.forEach((tab, i) => {
    for (const row of rowsByTab[i]) {
      words.push(parseWordRow(tab, row));
    }
  });

  return Response.json({
    fetchedAt: formatSeoulDateTime(new Date()),
    words,
    profile: toPublicProfile(profile),
  });
}
