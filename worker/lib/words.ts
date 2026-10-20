import type { StudyMode } from "../../shared/studyModes.ts";
/**
 * 시트 행(A2:L) ↔ 단어 객체 변환. PRD 4.2(컬럼 계약)·7.3(GET /api/words 응답)을 따른다.
 * POST /api/answer(#8)·POST /api/review-fail(#9)도 "GET과 같은 형태"로 응답해야 하므로
 * 여기 정규화 로직과, 탭+A열 한자로 행을 재탐색하는 findWordRow를 함께 재사용한다.
 */

import { getSheetTitles, getValues, SheetsApiError } from "./sheets.ts";

// A~F열 + 정답 타임스탬프 앞 6칸(G~L, PRD 4.2). lastCorrect는 학습 중 단어의 재출제 몫에만 쓰이는데,
// 학습 중에는 미달(<3) 모드만 출제되므로 졸업 전 정답은 모드당 최대 3개 → 최대 6칸이다.
// 졸업 후 복습 정답까지 다 읽으면 단어 수 × 복습 횟수만큼 응답이 계속 커지므로 여기서 끊는다.
// (모드 확대로 졸업 단어가 학습 중으로 돌아오면 7번째 이후 기록을 못 봐 lastCorrect가 실제보다
// 이를 수 있다 — 재출제 몫에 조금 일찍 들어올 뿐이라 감수한다.)
export const WORD_ROW_RANGE = "A2:L";

// G열(0-based 인덱스 6)부터가 정답 타임스탬프 영역(PRD 4.2).
const FIRST_TIMESTAMP_INDEX = 6;

/** `_` 접두 탭(학습 제외)을 뺀 탭 제목 목록. GET /api/words·GET /api/tabs·등록 시 헤더 원본 탭 선택이 공유한다. */
export async function getWordTabTitles(env: Env, sheetId: string): Promise<string[]> {
  const titles = await getSheetTitles(env, sheetId);
  return titles.filter((title) => !title.startsWith("_"));
}

export interface WordEntry {
  studyModes?: StudyMode[];
  tab: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  m1: number;
  m2: number;
  nextReview: string | null;
  interval: number | null;
  /** 마지막 정답 날짜(YYYY-MM-DD, G열 이후 타임스탬프 중 최신). 정답 기록이 없으면 null. */
  lastCorrect: string | null;
}

/** 한 행(A열~)을 단어 객체로 정규화한다. D·E 빈칸→0, F 빈칸→null 쌍, G열 이후→lastCorrect. */
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
    lastCorrect: latestTimestampDate(row.slice(FIRST_TIMESTAMP_INDEX)),
  };
}

// 타임스탬프 형식: `YYYY-MM-DD HH:mm|모드`. 날짜 부분만 사전식으로 비교해 최신 값을 고른다 —
// append 순서에 기대지 않아 시트 수동 편집에도 안전하다. 형식이 깨진 칸은 건너뛴다.
/** 타임스탬프 칸들 중 가장 최신 날짜(YYYY-MM-DD). 유효한 칸이 없으면 null. */
export function latestTimestampDate(cells: readonly string[]): string | null {
  let latest: string | null = null;
  for (const cell of cells) {
    const date = cell?.slice(0, 10);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && (latest === null || date > latest)) {
      latest = date;
    }
  }
  return latest;
}

export interface FoundWordRow {
  rowNumber: number;
  entry: WordEntry;
}

// 행 번호를 캐시하지 않고 쓰기 시점마다 재탐색한다(PRD 4.2 — 사용자가 시트를 정렬/삽입할 수 있음).
/** 탭+A열 한자로 행을 찾아 시트 행 번호(헤더 오프셋 +2)와 정규화된 단어를 함께 반환한다. 없으면 null. */
export async function findWordRow(
  env: Env,
  sheetId: string,
  tab: string,
  hanzi: string,
): Promise<FoundWordRow | null> {
  let rows: string[][];
  try {
    rows = await getValues(env, sheetId, tab, WORD_ROW_RANGE);
  } catch (err) {
    // 존재하지 않는 탭을 조회하면 Sheets API가 400(Unable to parse range)을 던진다 — "찾지 못함"으로 취급한다.
    if (err instanceof SheetsApiError && err.status === 400) {
      return null;
    }
    throw err;
  }
  const index = rows.findIndex((row) => row[0] === hanzi);
  if (index === -1) {
    return null;
  }
  return { rowNumber: index + 2, entry: parseWordRow(tab, rows[index]) };
}

/**
 * 탭 이름 + A열 한자로 행 번호를 캐시 없이 재탐색한다 (PRD 4.2 — 사용자가 시트를
 * 정렬·삽입할 수 있어 행 번호를 저장해두면 안 된다). 없으면 null.
 */
export async function findRowNumber(
  env: Env,
  sheetId: string,
  tab: string,
  hanzi: string,
): Promise<number | null> {
  let column: string[][];
  try {
    column = await getValues(env, sheetId, tab, "A2:A");
  } catch (err) {
    // 존재하지 않는 탭을 조회하면 Sheets API가 400(Unable to parse range)을 던진다 — "찾지 못함"으로 취급한다.
    if (err instanceof SheetsApiError && err.status === 400) {
      return null;
    }
    throw err;
  }
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
