import { describe, expect, it } from "vitest";
import { headwordLang, mode2Hint, mode2Placeholder, modeChipLabel } from "./contentLabels";

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
