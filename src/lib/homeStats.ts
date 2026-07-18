/**
 * design-prd §3 홈 화면 현황 카드·세션 수 집계. getWordState(§5.1)로 단어를
 * 분류한 뒤, 기능 PRD §6.1 큐 산식과 동일한 "오늘 세션 문제 수"를 계산한다.
 * 실제 큐 구성(#14)은 이 이슈 범위 밖 — 여기서는 문제 수만 센다.
 */

import { getWordState, type WordProgress } from "./wordState.ts";

const SESSION_CAP = 60;

export interface HomeStats {
  reviewDue: number;
  learning: number;
  /** design-prd §3: 졸업 수 = 복습 대기를 포함한 졸업 단어 총수 (reviewDue + reviewScheduled). */
  graduated: number;
  /** design-prd §3 / 기능 PRD §6.1: min(60, min(복습대기,60) + 학습중 후보 문제 수). */
  sessionCount: number;
}

export function computeHomeStats(words: WordProgress[], today: string): HomeStats {
  let reviewDue = 0;
  let reviewScheduled = 0;
  let learning = 0;
  let learningCandidates = 0;

  for (const word of words) {
    const state = getWordState(word, today);
    if (state === "learning") {
      learning += 1;
      if (word.m1 < 3) learningCandidates += 1;
      if (word.m2 < 3) learningCandidates += 1;
    } else if (state === "reviewDue") {
      reviewDue += 1;
    } else {
      reviewScheduled += 1;
    }
  }

  return {
    reviewDue,
    learning,
    graduated: reviewDue + reviewScheduled,
    sessionCount: Math.min(SESSION_CAP, Math.min(reviewDue, SESSION_CAP) + learningCandidates),
  };
}
