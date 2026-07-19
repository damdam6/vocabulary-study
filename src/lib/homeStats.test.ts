import { describe, expect, it } from "vitest";
import { computeHomeStats } from "./homeStats.ts";
import type { WordProgress } from "./wordState.ts";

describe("computeHomeStats", () => {
  const today = "2026-07-20";

  it("복습 대기/학습 중/복습 예약이 섞인 목록의 카운트를 올바르게 집계한다", () => {
    const words: WordProgress[] = [
      { m1: 3, m2: 3, nextReview: "2026-07-19" }, // reviewDue
      { m1: 3, m2: 3, nextReview: "2026-07-20" }, // reviewDue (경계값)
      { m1: 3, m2: 3, nextReview: "2026-07-21" }, // reviewScheduled
      { m1: 0, m2: 3, nextReview: null }, // learning (m1<3)
      { m1: 3, m2: 0, nextReview: null }, // learning (m2<3)
      { m1: 0, m2: 0, nextReview: null }, // learning (둘 다 미달이어도 단어당 1문제, #44)
    ];

    const stats = computeHomeStats(words, today);

    expect(stats.reviewDue).toBe(2);
    expect(stats.learning).toBe(3);
    // graduated = reviewDue(2) + reviewScheduled(1) — 복습 대기를 포함한 졸업 총수
    expect(stats.graduated).toBe(3);
    // sessionCount = min(60, min(2,60) + 학습중 3)
    expect(stats.sessionCount).toBe(5);
  });

  it("신규 단어만 48개면 세션 수도 48이다 — 단어당 1문제 (#44)", () => {
    const words: WordProgress[] = Array.from({ length: 48 }, () => ({
      m1: 0,
      m2: 0,
      nextReview: null,
    }));

    const stats = computeHomeStats(words, today);

    expect(stats.learning).toBe(48);
    expect(stats.sessionCount).toBe(48);
  });

  it("복습 대기가 60개를 넘으면 학습 중 후보를 더하지 않고 60에서 캡된다", () => {
    const reviewDueWords: WordProgress[] = Array.from({ length: 70 }, () => ({
      m1: 3,
      m2: 3,
      nextReview: "2026-07-19",
    }));
    const learningWords: WordProgress[] = [{ m1: 0, m2: 0, nextReview: null }];

    const stats = computeHomeStats([...reviewDueWords, ...learningWords], today);

    expect(stats.reviewDue).toBe(70);
    expect(stats.sessionCount).toBe(60);
  });

  it("단어가 없으면 모든 값이 0이다", () => {
    const stats = computeHomeStats([], today);
    expect(stats).toEqual({ reviewDue: 0, learning: 0, graduated: 0, sessionCount: 0 });
  });
});
