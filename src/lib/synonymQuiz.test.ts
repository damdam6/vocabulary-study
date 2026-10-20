import { describe, expect, it } from "vitest";
import { attachSynonymChoices, MAX_CHOICES } from "./synonymQuiz.ts";
import type { WordEntry } from "./api.ts";
import type { SessionQuestion } from "./sessionQueue.ts";

const TAB = "THES. 6급유의어";
function word(hanzi: string, meaning: string, synonymGroup: string, tab = TAB): WordEntry {
  return { tab, hanzi, pinyin: "", meaning, m1: 0, m2: 0, m3: 0, synonymGroup, nextReview: null, interval: null, studyModes: ["m3"] };
}
const question = (target: WordEntry): SessionQuestion<WordEntry> => ({ word: target, mode: "m3", isReview: false });

describe("attachSynonymChoices", () => {
  it("builds up to 4 choices only from the same tab and synonym group, always including the answer", () => {
    const target = word("美丽", "아름답다", "예쁨");
    const words = [
      target, word("漂亮", "예쁘다", "예쁨"), word("好看", "보기 좋다", "예쁨"),
      word("秀丽", "수려하다", "예쁨"), word("俊俏", "준수하다", "예쁨"),
      word("孤独", "고독하다", "외로움"), word("美观", "보기 좋다2", "예쁨", "다른 탭"),
    ];
    for (let i = 0; i < 20; i++) {
      const [result] = attachSynonymChoices([question(target)], words);
      expect(result.choices).toHaveLength(MAX_CHOICES);
      expect(result.choices).toContain(target);
      expect(result.choices!.every((choice) => choice.tab === TAB && choice.synonymGroup === "예쁨")).toBe(true);
      expect(["meaning", "hanzi"]).toContain(result.prompt);
    }
  });

  it("falls back to 2 choices and skips synonyms whose meaning matches the answer", () => {
    const target = word("孤独", "고독하다", "외로움");
    const words = [target, word("寂寞", "고독하다", "외로움"), word("孤单", "외롭다", "외로움")];
    const [result] = attachSynonymChoices([question(target)], words, () => 0.9);
    expect(result.choices!.map((choice) => choice.hanzi).toSorted()).toEqual(["孤单", "孤独"]);
  });

  it("leaves non-m3 questions untouched", () => {
    const plain: SessionQuestion<WordEntry> = { word: word("词", "단어", "", "단어"), mode: "m1", isReview: false };
    expect(attachSynonymChoices([plain], [])[0]).toBe(plain);
  });
});
