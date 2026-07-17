/**
 * POST /api/answer(#8)의 순수 계산 로직 — 시트 I/O 없음. PRD 5.1(졸업)·5.3(고정 간격 반복)·
 * 4.2(G열 append 계약)을 따른다.
 */

import { addSeoulDays } from "./time.ts";
import type { WordEntry } from "./words.ts";

export type AnswerMode = "m1" | "m2";

/** 모드별 정답 카운트가 쓰이는 열. */
export const MODE_COLUMN: Record<AnswerMode, "D" | "E"> = { m1: "D", m2: "E" };

const INTERVAL_LADDER = [1, 3, 7, 14, 30];

/** 간격 사다리에서 현재 간격보다 큰 다음 값. 30 이상이면 30 유지(PRD 5.3). */
export function nextLadderInterval(current: number): number {
  return INTERVAL_LADDER.find((step) => step > current) ?? INTERVAL_LADDER[INTERVAL_LADDER.length - 1];
}

// G열(0-based 인덱스 6)부터가 타임스탬프 기록 영역(PRD 4.2).
const FIRST_TIMESTAMP_COLUMN_INDEX = 6;

/** 행 배열에서 G열 이후 첫 빈 칸의 인덱스를 찾는다. 기존 타임스탬프는 건드리지 않는다. */
export function findNextEmptyColumn(row: string[]): number {
  let index = FIRST_TIMESTAMP_COLUMN_INDEX;
  while (row[index]) index++;
  return index;
}

/** 0-based 컬럼 인덱스를 시트 컬럼 문자로 변환한다 (예: 6→G, 25→Z, 26→AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export interface AnswerUpdate {
  m1: number;
  m2: number;
  nextReview: string | null;
  interval: number | null;
  /** F열을 새로 써야 하는지. false면 기존 값 그대로 두고 쓰기 자체를 생략한다. */
  nextReviewChanged: boolean;
}

/** 정답 1건을 반영한 새 상태를 계산한다. */
export function computeAnswerUpdate(
  current: Pick<WordEntry, "m1" | "m2" | "nextReview" | "interval">,
  mode: AnswerMode,
  isReview: boolean,
  now: Date,
): AnswerUpdate {
  const wasGraduated = current.m1 >= 3 && current.m2 >= 3;
  const m1 = mode === "m1" ? current.m1 + 1 : current.m1;
  const m2 = mode === "m2" ? current.m2 + 1 : current.m2;

  if (isReview) {
    const interval = nextLadderInterval(current.interval ?? 0);
    return { m1, m2, nextReview: addSeoulDays(now, interval), interval, nextReviewChanged: true };
  }

  const justGraduated = !wasGraduated && m1 >= 3 && m2 >= 3;
  if (justGraduated) {
    return { m1, m2, nextReview: addSeoulDays(now, 1), interval: 1, nextReviewChanged: true };
  }

  return { m1, m2, nextReview: current.nextReview, interval: current.interval, nextReviewChanged: false };
}
