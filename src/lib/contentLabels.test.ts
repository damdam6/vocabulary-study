import { describe, expect, it } from "vitest";
import {
  headwordLang,
  mode2Hint,
  mode2Placeholder,
  modeChipLabel,
  registerPlaceholder,
  registerTableHeaders,
} from "./contentLabels";

describe("modeChipLabel", () => {
  it("zh는 한자 문구", () => {
    expect(modeChipLabel("zh", "m1")).toBe("한자 → 뜻");
    expect(modeChipLabel("zh", "m2")).toBe("뜻 → 한자");
  });

  it("generic은 중립 문구", () => {
    expect(modeChipLabel("generic", "m1")).toBe("단어 → 뜻");
    expect(modeChipLabel("generic", "m2")).toBe("뜻 → 단어");
  });
});

describe("headwordLang", () => {
  it("zh는 zh-Hans", () => {
    expect(headwordLang("zh")).toBe("zh-Hans");
  });

  it("generic은 미적용(undefined)", () => {
    expect(headwordLang("generic")).toBeUndefined();
  });
});

describe("mode2Hint", () => {
  it("zh는 한자 입력 안내", () => {
    expect(mode2Hint("zh")).toBe("이 뜻의 한자를 입력하세요");
  });

  it("generic은 중립 안내", () => {
    expect(mode2Hint("generic")).toBe("이 뜻에 해당하는 단어를 입력하세요");
  });
});

describe("mode2Placeholder", () => {
  it("zh는 汉字", () => {
    expect(mode2Placeholder("zh")).toBe("汉字");
  });

  it("generic은 미적용(undefined)", () => {
    expect(mode2Placeholder("generic")).toBeUndefined();
  });
});

describe("registerTableHeaders", () => {
  it("zh는 한자/병음/뜻", () => {
    expect(registerTableHeaders("zh")).toEqual({ headword: "한자", note: "병음", meaning: "뜻" });
  });

  it("generic은 표제어/보조 표기/뜻", () => {
    expect(registerTableHeaders("generic")).toEqual({ headword: "표제어", note: "보조 표기", meaning: "뜻" });
  });
});

describe("registerPlaceholder", () => {
  it("zh는 hanzi/pinyin 스키마 예시", () => {
    const placeholder = registerPlaceholder("zh");
    expect(placeholder).toContain('"hanzi"');
    expect(placeholder).toContain('"pinyin"');
    expect(JSON.parse(placeholder)).toEqual({
      version: 1,
      words: [{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }],
    });
  });

  it("generic은 contentType:generic + term/note 스키마 예시", () => {
    const placeholder = registerPlaceholder("generic");
    expect(placeholder).toContain('"contentType":"generic"');
    expect(placeholder).toContain('"term"');
    const parsed = JSON.parse(placeholder);
    expect(parsed.contentType).toBe("generic");
    expect(parsed.words[0]).toHaveProperty("term");
    expect(parsed.words[0]).toHaveProperty("note");
  });
});
