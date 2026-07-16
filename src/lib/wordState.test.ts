import { describe, expect, it } from "vitest";
import { getSeoulToday, getWordState, type WordProgress } from "./wordState";

describe("getWordState", () => {
  const today = "2026-07-20";

  it("m1이 3 미만이면 학습 중 (m2, nextReview 무관)", () => {
    const word: WordProgress = { m1: 0, m2: 3, nextReview: null };
    expect(getWordState(word, today)).toBe("learning");
  });

  it("m2가 3 미만이면 학습 중 (m1, nextReview 무관)", () => {
    const word: WordProgress = { m1: 3, m2: 2, nextReview: "2026-07-01" };
    expect(getWordState(word, today)).toBe("learning");
  });

  it("nextReview: null인 미졸업 단어는 학습 중으로 분류된다", () => {
    const word: WordProgress = { m1: 1, m2: 0, nextReview: null };
    expect(getWordState(word, today)).toBe("learning");
  });

  it("졸업(m1≥3 && m2≥3) + nextReview가 과거면 복습 대기", () => {
    const word: WordProgress = { m1: 3, m2: 3, nextReview: "2026-07-19" };
    expect(getWordState(word, today)).toBe("reviewDue");
  });

  it("졸업 + nextReview가 오늘이면 복습 대기 (경계값)", () => {
    const word: WordProgress = { m1: 3, m2: 3, nextReview: "2026-07-20" };
    expect(getWordState(word, today)).toBe("reviewDue");
  });

  it("졸업 + nextReview가 미래면 복습 예약", () => {
    const word: WordProgress = { m1: 3, m2: 3, nextReview: "2026-07-21" };
    expect(getWordState(word, today)).toBe("reviewScheduled");
  });

  it("졸업했는데 nextReview가 null인 데이터 이상 상태는 복습 대기로 취급한다", () => {
    const word: WordProgress = { m1: 5, m2: 4, nextReview: null };
    expect(getWordState(word, today)).toBe("reviewDue");
  });
});

describe("getSeoulToday", () => {
  it("UTC 기준 서울 자정 직전 인스턴트는 이전 날짜를 반환한다", () => {
    expect(getSeoulToday(new Date("2026-07-19T14:59:00.000Z"))).toBe("2026-07-19");
  });

  it("UTC 기준 서울 자정 직후 인스턴트는 다음 날짜를 반환한다", () => {
    expect(getSeoulToday(new Date("2026-07-19T15:00:00.000Z"))).toBe("2026-07-20");
  });
});
