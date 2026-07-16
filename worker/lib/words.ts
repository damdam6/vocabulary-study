/**
 * 시트 행(A2:F) ↔ 단어 객체 변환. PRD 4.2(컬럼 계약)·7.3(GET /api/words 응답)을 따른다.
 * POST /api/answer(#8)도 "GET과 같은 형태"로 응답해야 하므로 여기 정규화 로직을 재사용한다.
 */

import { getValues } from "./sheets.ts";

export const WORD_ROW_RANGE = "A2:F";

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

/** A2:F 범위의 한 행(A~F열)을 단어 객체로 정규화한다. D·E 빈칸→0, F 빈칸→null 쌍. */
export function parseWordRow(tab: string, row: string[]): WordEntry {
  const [hanzi, pinyin, meaning, m1, m2, nextReviewRaw] = row;
  const { nextReview, interval } = parseNextReview(nextReviewRaw);
  return {
    tab,
    hanzi: hanzi ?? "",
    pinyin: pinyin ?? "",
    meaning: meaning ?? "",
    m1: Number(m1 || 0),
    m2: Number(m2 || 0),
    nextReview,
    interval,
  };
}

/**
 * 탭 이름 + A열 한자로 행 번호를 캐시 없이 재탐색한다 (PRD 4.2 — 사용자가 시트를
 * 정렬·삽입할 수 있어 행 번호를 저장해두면 안 된다). 없으면 null.
 */
export async function findRowNumber(env: Env, tab: string, hanzi: string): Promise<number | null> {
  const column = await getValues(env, tab, "A2:A");
  const index = column.findIndex((row) => row[0] === hanzi);
  return index === -1 ? null : index + 2;
}

// F열 형식: `YYYY-MM-DD|일수`. 수동 편집 등으로 형식이 깨지면 throw 대신 빈 상태로 취급한다.
function parseNextReview(raw: string | undefined): { nextReview: string | null; interval: number | null } {
  if (!raw) {
    return { nextReview: null, interval: null };
  }
  const [date, intervalStr] = raw.split("|");
  const interval = Number(intervalStr);
  if (!date || !intervalStr || Number.isNaN(interval)) {
    return { nextReview: null, interval: null };
  }
  return { nextReview: date, interval };
}
