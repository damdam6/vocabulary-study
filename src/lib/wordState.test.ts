import { describe, expect, it } from "vitest";
import { getSeoulToday, getWordState, type Mode, type WordProgress, type WordState } from "./wordState";

describe("getWordState", () => {
  const today = "2026-07-20";

  describe("M = {m1, m2} — 기존 동작 보존 (인자 추가만)", () => {
    it.each<[string, WordProgress, WordState]>([
      ["m1이 3 미만이면 학습 중 (m2, nextReview 무관)", { m1: 0, m2: 3, nextReview: null }, "learning"],
      ["m2가 3 미만이면 학습 중 (m1, nextReview 무관)", { m1: 3, m2: 2, nextReview: "2026-07-01" }, "learning"],
      ["nextReview: null인 미졸업 단어는 학습 중으로 분류된다", { m1: 1, m2: 0, nextReview: null }, "learning"],
      ["졸업(m1≥3 && m2≥3) + nextReview가 과거면 복습 대기", { m1: 3, m2: 3, nextReview: "2026-07-19" }, "reviewDue"],
      ["졸업 + nextReview가 오늘이면 복습 대기 (경계값)", { m1: 3, m2: 3, nextReview: "2026-07-20" }, "reviewDue"],
      ["졸업 + nextReview가 미래면 복습 예약", { m1: 3, m2: 3, nextReview: "2026-07-21" }, "reviewScheduled"],
      ["졸업했는데 nextReview가 null인 데이터 이상 상태는 복습 대기로 취급한다", { m1: 5, m2: 4, nextReview: null }, "reviewDue"],
    ])("%s", (_description, word, expected) => {
      expect(getWordState(word, today, ["m1", "m2"])).toBe(expected);
    });
  });

  describe("M = {m1} — 단일 모드 프로필", () => {
    const M: Mode[] = ["m1"];

    it.each<[string, WordProgress, WordState]>([
      ["m1이 3 미만이면 학습 중 (m2는 M 밖이라 무관)", { m1: 0, m2: 5, nextReview: null }, "learning"],
      ["m1이 정확히 3에 도달하면 졸업 (경계값, m2 무관) + nextReview 과거 → 복습 대기", { m1: 3, m2: 0, nextReview: "2026-07-19" }, "reviewDue"],
      ["졸업 + nextReview가 오늘이면 복습 대기 (경계값)", { m1: 3, m2: 0, nextReview: "2026-07-20" }, "reviewDue"],
      ["졸업 + nextReview가 미래면 복습 예약", { m1: 4, m2: 0, nextReview: "2026-07-21" }, "reviewScheduled"],
      ["졸업했는데 nextReview가 null이면 데이터 이상 상태 → 복습 대기", { m1: 3, m2: 0, nextReview: null }, "reviewDue"],
    ])("%s", (_description, word, expected) => {
      expect(getWordState(word, today, M)).toBe(expected);
    });
  });

  describe("M = {m2} — 단일 모드 프로필", () => {
    const M: Mode[] = ["m2"];

    it.each<[string, WordProgress, WordState]>([
      ["m2가 3 미만이면 학습 중 (m1는 M 밖이라 무관)", { m1: 5, m2: 0, nextReview: null }, "learning"],
      ["m2가 정확히 3에 도달하면 졸업 (경계값, m1 무관) + nextReview 과거 → 복습 대기", { m1: 0, m2: 3, nextReview: "2026-07-19" }, "reviewDue"],
      ["졸업 + nextReview가 오늘이면 복습 대기 (경계값)", { m1: 0, m2: 3, nextReview: "2026-07-20" }, "reviewDue"],
      ["졸업 + nextReview가 미래면 복습 예약", { m1: 0, m2: 4, nextReview: "2026-07-21" }, "reviewScheduled"],
      ["졸업했는데 nextReview가 null이면 데이터 이상 상태 → 복습 대기", { m1: 0, m2: 3, nextReview: null }, "reviewDue"],
    ])("%s", (_description, word, expected) => {
      expect(getWordState(word, today, M)).toBe(expected);
    });
  });

  describe("PRD-general §4.3 — 모드 축소 재해석 엣지", () => {
    it("m1≥3·m2<3 단어가 M={m1}·F열 빈칸에서 복습 대기로 분류된다 (자가치유 경로)", () => {
      const word: WordProgress = { m1: 3, m2: 1, nextReview: null };
      // M={m1,m2}였다면 m2<3이라 학습 중이었을 단어. M을 {m1}로 축소하면 m1≥3이라
      // 곧바로 졸업 취급되는데 F열(nextReview)이 아직 없어 데이터 이상 자가치유
      // 경로(§4.3)를 타 복습 대기가 된다.
      expect(getWordState(word, today, ["m1"])).toBe("reviewDue");
    });
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
