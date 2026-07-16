/**
 * 시트 행(A2:F) ↔ 단어 객체 변환. PRD 4.2(컬럼 계약)·7.3(GET /api/words 응답)을 따른다.
 * POST /api/answer(#8)·POST /api/review-fail(#9)도 "GET과 같은 형태"로 응답해야 하므로
 * 여기 정규화 로직과, 탭+A열 한자로 행을 재탐색하는 findWordRow를 함께 재사용한다.
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

export interface FoundWordRow {
  rowNumber: number;
  entry: WordEntry;
}

// 행 번호를 캐시하지 않고 쓰기 시점마다 재탐색한다(PRD 4.2 — 사용자가 시트를 정렬/삽입할 수 있음).
/** 탭+A열 한자로 행을 찾아 시트 행 번호(헤더 오프셋 +2)와 정규화된 단어를 함께 반환한다. 없으면 null. */
export async function findWordRow(env: Env, tab: string, hanzi: string): Promise<FoundWordRow | null> {
  const rows = await getValues(env, tab, WORD_ROW_RANGE);
  const index = rows.findIndex((row) => row[0] === hanzi);
  if (index === -1) {
    return null;
  }
  return { rowNumber: index + 2, entry: parseWordRow(tab, rows[index]) };
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
