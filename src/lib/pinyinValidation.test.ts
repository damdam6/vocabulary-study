import { describe, expect, it } from "vitest";
import { isPinyinMatch } from "./pinyinValidation";

describe("isPinyinMatch", () => {
  it("정상 다중 음절 단어는 일치하면 true", () => {
    expect(isPinyinMatch("经济", "jīngjì")).toBe(true);
  });

  it("다음자 — 기본값이 아닌 후보도 통과한다 (行의 기본 단독 발음은 xíng이지만 háng도 유효 후보)", () => {
    expect(isPinyinMatch("行", "háng")).toBe(true);
  });

  it("다음자 — 기본 후보도 통과한다", () => {
    expect(isPinyinMatch("行", "xíng")).toBe(true);
  });

  it("다음자 — 후보에 없는 값이면 false", () => {
    expect(isPinyinMatch("行", "qwe")).toBe(false);
  });

  it("음절 사이 공백은 무시하고 비교한다", () => {
    expect(isPinyinMatch("经济", "jīng jì")).toBe(true);
  });

  it("대소문자를 무시하고 비교한다", () => {
    expect(isPinyinMatch("经济", "JīngJì")).toBe(true);
  });

  it("완전히 다른 병음이면 false", () => {
    expect(isPinyinMatch("经济", "nǐhǎo")).toBe(false);
  });

  it("성조 부호 없는 입력은 차단된다 (후보는 항상 성조 부호를 포함)", () => {
    expect(isPinyinMatch("经济", "jingji")).toBe(false);
  });

  it("숫자 성조 표기 입력은 차단된다", () => {
    expect(isPinyinMatch("经济", "jing1ji4")).toBe(false);
  });

  it("빈 한자나 빈 병음이면 false", () => {
    expect(isPinyinMatch("", "jīngjì")).toBe(false);
    expect(isPinyinMatch("经济", "")).toBe(false);
  });
});
