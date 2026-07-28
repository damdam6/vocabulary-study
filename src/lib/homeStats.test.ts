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

    const stats = computeHomeStats(words, today, ["m1", "m2"]);

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

    const stats = computeHomeStats(words, today, ["m1", "m2"]);

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

    const stats = computeHomeStats([...reviewDueWords, ...learningWords], today, ["m1", "m2"]);

    expect(stats.reviewDue).toBe(70);
    expect(stats.sessionCount).toBe(60);
  });

  it("단어가 없으면 모든 값이 0이다", () => {
    const stats = computeHomeStats([], today, ["m1", "m2"]);
    expect(stats).toEqual({ reviewDue: 0, learning: 0, graduated: 0, sessionCount: 0 });
  });

  it("limit을 생략하면 60(SESSION_CAP)이 그대로 상한이다 — 기존 동작 보존", () => {
    const reviewDueWords: WordProgress[] = Array.from({ length: 70 }, () => ({
      m1: 3,
      m2: 3,
      nextReview: "2026-07-19",
    }));

    const stats = computeHomeStats(reviewDueWords, today, ["m1", "m2"]);

    expect(stats.sessionCount).toBe(60);
  });

  it("limit=30이면 복습 대기 컷·sessionCount 상한 모두 30이다", () => {
    const reviewDueWords: WordProgress[] = Array.from({ length: 40 }, () => ({
      m1: 3,
      m2: 3,
      nextReview: "2026-07-19",
    }));
    const learningWords: WordProgress[] = [
      { m1: 0, m2: 0, nextReview: null },
      { m1: 0, m2: 0, nextReview: null },
    ];

    const stats = computeHomeStats([...reviewDueWords, ...learningWords], today, ["m1", "m2"], 30);

    // sessionCount = min(30, min(40,30) + 2) = min(30, 32) = 30
    expect(stats.reviewDue).toBe(40);
    expect(stats.sessionCount).toBe(30);
  });

  it("limit=1이면 sessionCount는 최대 1이다", () => {
    const words: WordProgress[] = [
      { m1: 3, m2: 3, nextReview: "2026-07-19" },
      { m1: 0, m2: 0, nextReview: null },
    ];

    const stats = computeHomeStats(words, today, ["m1", "m2"], 1);

    expect(stats.sessionCount).toBe(1);
  });

  it("modes가 판정에 반영된다 — M={m1}이면 m2 미달 단어도 M 기준으로 졸업 취급된다", () => {
    const words: WordProgress[] = [
      { m1: 3, m2: 0, nextReview: "2026-07-19" }, // M={m1,m2}면 학습 중, M={m1}이면 복습 대기
      { m1: 0, m2: 3, nextReview: null }, // M={m1}이면 m1<3이라 여전히 학습 중
    ];

    const statsFullModes = computeHomeStats(words, today, ["m1", "m2"]);
    expect(statsFullModes.learning).toBe(2);
    expect(statsFullModes.reviewDue).toBe(0);

    const statsSingleMode = computeHomeStats(words, today, ["m1"]);
    expect(statsSingleMode.reviewDue).toBe(1);
    expect(statsSingleMode.learning).toBe(1);
  });
});
