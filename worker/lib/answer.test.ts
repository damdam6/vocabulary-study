import { describe, expect, it } from "vitest";
import { computeAnswerUpdate, type AnswerMode, type AnswerUpdate } from "./answer.ts";
import { addSeoulDays } from "./time.ts";

interface Current {
  m1: number;
  m2: number;
  nextReview: string | null;
  interval: number | null;
}

const NOW = new Date("2026-07-27T03:00:00.000Z"); // Asia/Seoul 낮 12시 → addSeoulDays(1) = 2026-07-28

function current(overrides: Partial<Current> = {}): Current {
  return { m1: 0, m2: 0, nextReview: null, interval: null, ...overrides };
}

describe("computeAnswerUpdate — M = {m1, m2} 기존 동작 보존 (인자 추가만)", () => {
  const M: AnswerMode[] = ["m1", "m2"];

  it("학습 중(둘 다 3 미만) 정답은 카운트만 증가, F열 불변", () => {
    const result = computeAnswerUpdate(current({ m1: 0, m2: 1 }), "m1", false, NOW, M);
    expect(result).toEqual<AnswerUpdate>({
      m1: 1,
      m2: 1,
      nextReview: null,
      interval: null,
      nextReviewChanged: false,
    });
  });

  it("m1이 3에 도달해도 m2가 3 미만이면 미졸업", () => {
    const result = computeAnswerUpdate(current({ m1: 2, m2: 1 }), "m1", false, NOW, M);
    expect(result.m1).toBe(3);
    expect(result.nextReviewChanged).toBe(false);
    expect(result.nextReview).toBeNull();
  });

  it("둘 다 3에 도달하는 순간 첫 졸업 — F열 내일|1", () => {
    const result = computeAnswerUpdate(current({ m1: 3, m2: 2 }), "m2", false, NOW, M);
    expect(result).toEqual<AnswerUpdate>({
      m1: 3,
      m2: 3,
      nextReview: "2026-07-28",
      interval: 1,
      nextReviewChanged: true,
    });
  });

  it("이미 졸업한 단어의 비복습 정답은 F열을 다시 건드리지 않는다", () => {
    const result = computeAnswerUpdate(
      current({ m1: 3, m2: 3, nextReview: "2026-08-01", interval: 3 }),
      "m1",
      false,
      NOW,
      M,
    );
    expect(result.nextReviewChanged).toBe(false);
    expect(result.nextReview).toBe("2026-08-01");
    expect(result.interval).toBe(3);
  });

  it.each<[number, number]>([
    [1, 3],
    [3, 7],
    [7, 14],
    [14, 30],
    [30, 30],
  ])("복습 정답은 간격 사다리를 %i → %i로 올린다 (졸업 상태 무관)", (before, after) => {
    const result = computeAnswerUpdate(
      current({ m1: 3, m2: 3, nextReview: "2026-07-20", interval: before }),
      "m1",
      true,
      NOW,
      M,
    );
    expect(result.interval).toBe(after);
    expect(result.nextReview).toBe(addSeoulDays(NOW, after));
    expect(result.nextReviewChanged).toBe(true);
  });
});

describe("computeAnswerUpdate — M = {m1} 단일 모드 프로필", () => {
  const M: AnswerMode[] = ["m1"];

  it("D열(m1)이 3번째 정답으로 3에 도달하면 E열 값과 무관하게 졸업", () => {
    const result = computeAnswerUpdate(current({ m1: 2, m2: 0 }), "m1", false, NOW, M);
    expect(result).toEqual<AnswerUpdate>({
      m1: 3,
      m2: 0,
      nextReview: "2026-07-28",
      interval: 1,
      nextReviewChanged: true,
    });
  });

  it("E열(m2)이 이미 3 이상이어도 D열이 3 미만이면 미졸업", () => {
    const result = computeAnswerUpdate(current({ m1: 1, m2: 5 }), "m1", false, NOW, M);
    expect(result.m1).toBe(2);
    expect(result.nextReviewChanged).toBe(false);
  });

  it("m2 정답은 M 밖이라 졸업 판정에 영향 없음 (카운트만 증가)", () => {
    const result = computeAnswerUpdate(current({ m1: 3, m2: 0 }), "m2", false, NOW, M);
    expect(result.m2).toBe(1);
    expect(result.nextReviewChanged).toBe(false);
  });
});

describe("computeAnswerUpdate — M = {m2} 단일 모드 프로필 (대칭)", () => {
  const M: AnswerMode[] = ["m2"];

  it("E열(m2)이 3번째 정답으로 3에 도달하면 D열 값과 무관하게 졸업", () => {
    const result = computeAnswerUpdate(current({ m1: 0, m2: 2 }), "m2", false, NOW, M);
    expect(result).toEqual<AnswerUpdate>({
      m1: 0,
      m2: 3,
      nextReview: "2026-07-28",
      interval: 1,
      nextReviewChanged: true,
    });
  });

  it("D열(m1)이 이미 3 이상이어도 E열이 3 미만이면 미졸업", () => {
    const result = computeAnswerUpdate(current({ m1: 5, m2: 1 }), "m2", false, NOW, M);
    expect(result.m2).toBe(2);
    expect(result.nextReviewChanged).toBe(false);
  });
});
