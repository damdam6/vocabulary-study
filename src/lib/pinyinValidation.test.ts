import { type Mock, afterEach, describe, expect, it, vi } from "vitest";
import * as provider from "pinyin-pro";
import { MAX_PINYIN_TRANSITIONS, reviewPinyin } from "./pinyinValidation";

vi.mock("pinyin-pro", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pinyin-pro")>();
  return { ...actual, pinyin: vi.fn(actual.pinyin) };
});
// pinyin overloads include AllData[]; this module exercises only type: array.
const lookup = vi.mocked(provider.pinyin) as unknown as Mock<(char: string, options: unknown) => string[]>;
afterEach(() => { vi.mocked(provider.pinyin).mockReset(); vi.restoreAllMocks(); });

describe("병음 보조 검토", () => {
  it.each([
    ["今天", "jīntiān"], ["我今天很忙。", "wǒ jīntiān hěn máng."],
    ["今天", " JĪN　TIĀN "], ["西安", "xī’ān"], ["今天", "ji\u0304ntiān"],
  ])("안전한 후보 일치: %s", (hanzi, claim) => expect(reviewPinyin(hanzi, claim)).toBe("match"));

  it("명백한 문자별 후보 불일치는 검토 대상으로 반환한다", () => {
    expect(reviewPinyin("今天", "nǐ hǎo")).toBe("mismatch");
  });

  it.each([
    ["行", "háng"], ["行", "xíng"], ["经济", "jīngjì"],
    ["你好", "ní hǎo"], ["你很忙", "nǐ hěn máng"], ["你很忙", "ní hěn máng"], ["一个", "yí ge"], ["不对", "bú duì"],
    ["我有2本书。", "wǒ yǒu liǎng běn shū."], ["我用AI学习。", "wǒ yòng AI xuéxí."],
    ["我用ＡＩ学习。", "wǒ yòng AI xuéxí."], ["鿿", "nǐ"], ["", ""],
  ])("문맥/변조/혼합/미등록 후보를 확인 완료로 보이지 않는다: %s", (hanzi, claim) => {
    expect(reviewPinyin(hanzi, claim)).toBe("unverified");
  });

  it("최대 원문 길이에서도 일치/불일치가 종료된다", () => {
    expect(reviewPinyin("天".repeat(200), "tiān".repeat(200))).toBe("match");
    expect(reviewPinyin("天".repeat(200), "tiān".repeat(199) + "hǎo")).toBe("mismatch");
    expect(reviewPinyin("你".repeat(201), "nǐ")).toBe("unverified");
    expect(reviewPinyin("你", "ā".repeat(1001))).toBe("unverified");
  });

  it("후보 조합이 커져도 예산 안에서 중단하고 같은 문자는 한 번만 조회한다", () => {
    lookup.mockReturnValue(["ā", "āā", "āāā", "āāāā"]);
    const startsWith = vi.spyOn(String.prototype, "startsWith");
    expect(reviewPinyin("你".repeat(200), "ā".repeat(800))).toBe("unverified");
    // 후보 전이를 실제로 예산까지 탐색했고 추가 전이는 수행하지 않았다.
    expect(startsWith.mock.calls.length).toBe(MAX_PINYIN_TRANSITIONS);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("경성 후보는 성조가 있는 다른 음절과 함께 비교할 수 있다", () => {
    lookup.mockImplementation((char) => char === "你" ? ["nǐ"] : ["ma"]);
    expect(reviewPinyin("你吗", "nǐ ma")).toBe("match");
  });
});
