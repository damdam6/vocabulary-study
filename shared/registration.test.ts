import { describe, expect, it } from "vitest";
import {
  codePointLength, normalizeRegistrationText, REGISTRATION_PUNCTUATION, validateZhRegistrationWord,
} from "./registration.ts";
import fixturesSource from "../tests/fixtures/chinese-sentence-registration.json?raw";

const fixtures = JSON.parse(fixturesSource) as {
  cases: { id: string; contentType: string; words: unknown[]; accepted: boolean; expectedWords?: unknown[] }[];
};
const word = { hanzi: "你好", pinyin: "nǐ hǎo", meaning: "안녕" };

describe("zh 공통 등록 형식", () => {
  it.each(fixtures.cases.filter((c) => c.contentType === "zh" && c.words.length === 1))("$id", (c) => {
    const result = validateZhRegistrationWord(c.words[0]);
    expect(result.ok).toBe(c.accepted);
    if (result.ok) expect(result.word).toEqual(c.expectedWords?.[0]);
  });

  // PRD 고정 목록을 독립적으로 명시해 상수의 누락/추가도 검출한다.
  const punctuation = `，。！？；：、,.!?;:（）()【】[]《》〈〉“”‘’「」『』"'…—-·／/％%＋+＝=．`;
  it("허용 부호 목록은 PRD와 같다", () => {
    expect(REGISTRATION_PUNCTUATION).toBe(punctuation);
  });
  it.each(Array.from(punctuation))("원문과 병음에 %s 허용", (ch) => {
    expect(validateZhRegistrationWord({ ...word, hanzi: `你${ch}好`, pinyin: `nǐ${ch}hǎo` }).ok).toBe(true);
  });
  it.each(["一", "鿿", "我用AZaz09ＡＺａｚ０９学习。"])("원문 범위 %s 허용", (hanzi) => {
    expect(validateZhRegistrationWord({ ...word, hanzi }).ok).toBe(true);
  });
  it("ASCII 알파벳 전체와 대문자 병음을 허용한다", () => {
    expect(validateZhRegistrationWord({ ...word, pinyin: "NǏ abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ Ü" }).ok).toBe(true);
  });
  it("모든 C0/C1 제어문자는 양끝과 내부에서도 차단한다", () => {
    const controls = Array.from({ length: 160 }, (_, i) => i).filter((n) => n < 32 || n >= 127);
    for (const n of controls) {
      const ch = String.fromCodePoint(n);
      for (const field of ["hanzi", "pinyin"] as const) {
        for (const value of [ch + word[field], word[field] + ch, word[field][0] + ch + word[field].slice(1)]) {
          const result = validateZhRegistrationWord({ ...word, [field]: value });
          expect(result.ok, `${field}: U+${n.toString(16)}`).toBe(false);
          if (!result.ok) expect(result.issues).toContainEqual({ field, code: "invalid_character" });
        }
      }
    }
  });
  it.each(["\ud800", "\udfff", "\u00a0", "\u200b", "\u2028", "\ufeff", "é", "㐀", "𠀀"])("허용 범위 밖 문자는 trim으로 사라져도 오류", (ch) => {
    expect(validateZhRegistrationWord({ ...word, hanzi: ch + word.hanzi }).ok).toBe(false);
  });
  it("코드 포인트를 세고 NFC 후 정규화한다", () => {
    expect(codePointLength("你😀𠀀")).toBe(3);
    expect(normalizeRegistrationText("　ni\u030c　")).toBe("nǐ");
  });
  it("뜻에는 NFC나 신규 제한을 적용하지 않는다", () => {
    expect(validateZhRegistrationWord({ ...word, meaning: " cafe\u0301\n뜻 " })).toEqual({
      ok: true, word: { ...word, meaning: "cafe\u0301\n뜻" },
    });
  });
  it.each([
    ["hanzi", "", "required"], ["hanzi", "Hello!", "missing_hanzi"],
    ["hanzi", "你".repeat(201), "too_long"], ["pinyin", "ā".repeat(1001), "too_long"],
    ["pinyin", "ni hao", "missing_tone"], ["pinyin", "nǐ3", "invalid_character"],
    ["meaning", null, "invalid_type"],
  ])("필드별 오류 %s / %s", (field, value, code) => {
    const result = validateZhRegistrationWord({ ...word, [field as string]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ field, code });
  });
});
