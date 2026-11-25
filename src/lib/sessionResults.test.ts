import { describe, expect, it } from "vitest";
import type { WordEntry } from "./api";
import type { QuestionResult } from "./studySession";
import {
  formatResultTime,
  isSelfJudgedWrong,
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

describe("visibleAnswer / isSelfJudgedWrong", () => {
  it("모드2 오답의 입력만 앞뒤 공백을 걷어 보여 준다", () => {
    expect(visibleAnswer(result("犹豫", false, { mode: "m2", answer: "  尤豫 " }))).toBe("尤豫");
    expect(visibleAnswer(result("犹豫", false, { mode: "m2", answer: "   " }))).toBeNull();
    expect(visibleAnswer(result("犹豫", true, { mode: "m2", answer: "犹豫" }))).toBeNull();
    expect(visibleAnswer(result("犹豫", false))).toBeNull();
  });

  it("모드1 오답만 '몰랐음' 선택이다", () => {
    expect(isSelfJudgedWrong(result("一", false))).toBe(true);
    expect(isSelfJudgedWrong(result("一", false, { mode: "m2" }))).toBe(false);
    expect(isSelfJudgedWrong(result("一", true))).toBe(false);
  });
});

describe("wrapText", () => {
  const measure = (value: string) => Array.from(value).length * 10;

  it("중국어는 글자 사이, 한국어·영어는 공백에서 끊는다", () => {
    expect(wrapText("他昨天没来上班。", 50, measure)).toEqual(["他昨天没来", "上班。"]);
    expect(wrapText("그는 어제 출근하지 않았다", 90, measure)).toEqual(["그는 어제", "출근하지 않았다"]);
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
    expect(formatResultTime(date)).toBe("오후 9:42");
  });
});
