import { describe, expect, it } from "vitest";
import type { WordEntry } from "./api";
import type { QuestionResult } from "./studySession";
import {
  formatResultTime,
  ITEMS_PER_IMAGE,
  paginateResults,
  resultImageFileName,
  summarizeResults,
  visibleAnswer,
  wrapText,
} from "./sessionResults";

function result(hanzi: string, correct: boolean, overrides: Partial<QuestionResult> = {}): QuestionResult {
  const word: WordEntry = { tab: "HSK6", hanzi, pinyin: "", meaning: "뜻", m1: 0, m2: 0, nextReview: null, interval: null };
  return { word, mode: "m1", isReview: false, correct, ...overrides };
}

describe("summarizeResults", () => {
  it("틀린 문제·맞힌 문제를 출제 순서대로 나누고 원래 번호를 붙인다", () => {
    const summary = summarizeResults([result("一", true), result("二", false), result("三", true), result("四", false)]);
    expect(summary.wrongItems.map((item) => [item.num, item.word.hanzi])).toEqual([[2, "二"], [4, "四"]]);
    expect(summary.correctItems.map((item) => [item.num, item.word.hanzi])).toEqual([[1, "一"], [3, "三"]]);
    expect(summary).toMatchObject({ total: 4, correct: 2, wrong: 2, rate: 50 });
  });

  it("정답률은 반올림하고 문제가 없으면 0이다", () => {
    expect(summarizeResults([result("一", true), result("二", true), result("三", false)]).rate).toBe(67);
    expect(summarizeResults([]).rate).toBe(0);
  });
});

describe("visibleAnswer", () => {
  it("모드2 오답의 입력만 앞뒤 공백을 걷어 보여 준다", () => {
    expect(visibleAnswer(result("犹豫", false, { mode: "m2", answer: "  尤豫 " }))).toBe("尤豫");
    expect(visibleAnswer(result("犹豫", false, { mode: "m2", answer: "   " }))).toBeNull();
    expect(visibleAnswer(result("犹豫", true, { mode: "m2", answer: "犹豫" }))).toBeNull();
    expect(visibleAnswer(result("犹豫", false))).toBeNull();
  });
});

describe("wrapText", () => {
  const measure = (value: string) => Array.from(value).length * 10;

  it("중국어는 글자 사이, 한국어·영어는 공백에서 끊는다", () => {
    expect(wrapText("他昨天没来上班。", 50, measure)).toEqual(["他昨天没来", "上班。"]);
    expect(wrapText("그는 어제 출근하지 않았다", 90, measure)).toEqual(["그는 어제", "출근하지 않았다"]);
  });

  it("닫는 문장부호는 줄 첫머리에 홀로 남지 않고 앞 글자와 함께 넘어간다", () => {
    expect(wrapText("他昨天没来上班。", 70, measure)).toEqual(["他昨天没来上", "班。"]);
    expect(wrapText("没来上班。", 40, measure)).toEqual(["没来上", "班。"]);
  });

  it("한 단어가 너무 길면 글자 단위로 끊고, 빈 문자열은 빈 배열이다", () => {
    expect(wrapText("abcdefghij", 40, measure)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("   ", 40, measure)).toEqual([]);
  });
});

describe("이미지 파일 이름·시각", () => {
  const date = new Date("2026-11-25T12:42:00Z"); // 서울 21:42

  it("Asia/Seoul 기준으로 만든다", () => {
    expect(resultImageFileName(date)).toBe("session-result-20261125-2142.png");
    expect(resultImageFileName(date, 1, 1)).toBe("session-result-20261125-2142.png");
    expect(resultImageFileName(date, 2, 3)).toBe("session-result-20261125-2142-2.png");
    expect(formatResultTime(date)).toBe("오후 9:42");
  });
});

describe("paginateResults", () => {
  const many = (wrong: number, correct: number) =>
    summarizeResults([
      ...Array.from({ length: wrong }, (_, i) => result(`错${i}`, false)),
      ...Array.from({ length: correct }, (_, i) => result(`对${i}`, true)),
    ]);
  const shape = (pages: ReturnType<typeof paginateResults>) =>
    pages.map((page) => [page.page, page.pageCount, page.blocks.map((b) => [b.kind, b.continued, b.items.length])]);

  it("한 장에 120개씩, 틀린 문제 → 맞힌 문제 순서로 나누고 이어지는 구간을 표시한다", () => {
    expect(ITEMS_PER_IMAGE).toBe(120);
    expect(shape(paginateResults(many(130, 170)))).toEqual([
      [1, 3, [["wrong", false, 120]]],
      [2, 3, [["wrong", true, 10], ["correct", false, 110]]],
      [3, 3, [["correct", true, 60]]],
    ]);
  });

  it("120개 이하는 한 장, 정확히 경계에서 끝나는 구간은 다음 장에서 이어지지 않는다", () => {
    expect(shape(paginateResults(many(3, 117)))).toEqual([[1, 1, [["wrong", false, 3], ["correct", false, 117]]]]);
    expect(shape(paginateResults(many(120, 1)))).toEqual([
      [1, 2, [["wrong", false, 120]]],
      [2, 2, [["correct", false, 1]]],
    ]);
  });

  it("문제가 없어도 요약용 한 장을 만든다", () => {
    expect(shape(paginateResults(many(0, 0)))).toEqual([[1, 1, []]]);
  });
});
