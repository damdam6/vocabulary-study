import { describe, expect, it } from "vitest";
import { normalizeTabName, parseRegisterWords, partitionByExisting } from "./register.ts";

describe("parseRegisterWords", () => {
  it("정상 배열은 트림된 형태로 통과한다", () => {
    const result = parseRegisterWords([{ hanzi: " 经济 ", pinyin: " jīngjì ", meaning: " 경제 " }]);
    expect(result).toEqual([{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }]);
  });

  it("빈 배열은 null", () => {
    expect(parseRegisterWords([])).toBeNull();
  });

  it("배열이 아니면 null", () => {
    expect(parseRegisterWords({ hanzi: "经济" })).toBeNull();
  });

  it("필드 누락이면 null", () => {
    expect(parseRegisterWords([{ hanzi: "经济", pinyin: "jīngjì" }])).toBeNull();
  });

  it("필드 타입이 문자열이 아니면 null", () => {
    expect(parseRegisterWords([{ hanzi: "经济", pinyin: "jīngjì", meaning: 1 }])).toBeNull();
  });

  it("트림 후 빈 문자열 필드는 null", () => {
    expect(parseRegisterWords([{ hanzi: "  ", pinyin: "jīngjì", meaning: "경제" }])).toBeNull();
  });

  it("배열 내 한자 중복은 null", () => {
    const dup = [
      { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
      { hanzi: "经济", pinyin: "jīngjì", meaning: "경제학" },
    ];
    expect(parseRegisterWords(dup)).toBeNull();
  });
});

describe("normalizeTabName", () => {
  it("앞뒤 공백을 트림한다", () => {
    expect(normalizeTabName("  HSK6급  ")).toEqual({ name: "HSK6급" });
  });

  it("문자열이 아니면 error", () => {
    expect(normalizeTabName(123)).toEqual({ error: expect.any(String) });
  });

  it("트림 후 빈 문자열이면 error", () => {
    expect(normalizeTabName("   ")).toEqual({ error: expect.any(String) });
  });

  it("_로 시작하면 error", () => {
    expect(normalizeTabName("_설정")).toEqual({ error: expect.any(String) });
  });

  it("트림 후 _로 시작해도 error", () => {
    expect(normalizeTabName("  _설정")).toEqual({ error: expect.any(String) });
  });
});

describe("partitionByExisting", () => {
  const words = [
    { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
    { hanzi: "严重", pinyin: "yánzhòng", meaning: "심각하다" },
  ];

  it("기존 한자와 겹치면 skipped, 아니면 toAdd", () => {
    const result = partitionByExisting(words, ["经济"]);
    expect(result.toAdd).toEqual([words[1]]);
    expect(result.skipped).toEqual(["经济"]);
  });

  it("기존 한자가 없으면 전부 toAdd", () => {
    const result = partitionByExisting(words, []);
    expect(result.toAdd).toEqual(words);
    expect(result.skipped).toEqual([]);
  });

  it("전부 기존 한자와 겹치면 전부 skipped", () => {
    const result = partitionByExisting(words, ["经济", "严重"]);
    expect(result.toAdd).toEqual([]);
    expect(result.skipped).toEqual(["经济", "严重"]);
  });
});
