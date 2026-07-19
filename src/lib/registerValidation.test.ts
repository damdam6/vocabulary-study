import { describe, expect, it } from "vitest";
import { validateNewTabName, validateRegistrationInput } from "./registerValidation";

const EMPTY = new Set<string>();

function batch(words: unknown[], version: unknown = 1): string {
  return JSON.stringify({ version, words });
}

describe("validateRegistrationInput", () => {
  it("정상 단어는 모두 valid로 분류된다", () => {
    const result = validateRegistrationInput(
      batch([{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }]),
      EMPTY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { hanzi: "经济", pinyin: "jīngjì", meaning: "경제", status: "valid", reasons: [] },
    ]);
  });

  it("JSON으로 파싱할 수 없으면 최상위 오류를 반환한다", () => {
    const result = validateRegistrationInput("not json", EMPTY);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("JSON") });
  });

  it("words 배열이 없으면 최상위 오류를 반환한다", () => {
    const result = validateRegistrationInput(JSON.stringify({ version: 1 }), EMPTY);
    expect(result.ok).toBe(false);
  });

  it("words 배열이 비어 있으면 최상위 오류를 반환한다", () => {
    const result = validateRegistrationInput(batch([]), EMPTY);
    expect(result.ok).toBe(false);
  });

  it("version이 1이 아니면 최상위 오류를 반환한다", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }], 2), EMPTY);
    expect(result.ok).toBe(false);
  });

  it("한자가 비어 있으면 blocked", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "", pinyin: "jīngjì", meaning: "경제" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("한자가 비어 있습니다");
  });

  it("병음이 비어 있으면 blocked", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "经济", pinyin: "", meaning: "경제" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("병음이 비어 있습니다");
  });

  it("뜻이 비어 있으면 blocked", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "经济", pinyin: "jīngjì", meaning: "" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("뜻이 비어 있습니다");
  });

  it("한자 유니코드 범위를 벗어나면 blocked", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "abc经", pinyin: "jīngjì", meaning: "경제" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("한자 유니코드 범위를 벗어난 문자가 있습니다");
  });

  it("한자와 병음이 일치하지 않으면 blocked", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "经济", pinyin: "nǐhǎo", meaning: "경제" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("한자와 병음이 일치하지 않습니다");
  });

  it("다음자 후보 중 하나만 일치해도 통과한다 (파이프라인 통합 확인)", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "行", pinyin: "háng", meaning: "은행 등에서 쓰는 항" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
  });

  it("입력 내 중복된 한자는 둘 다 blocked", () => {
    const result = validateRegistrationInput(
      batch([
        { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
        { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
      ]),
      EMPTY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("입력 내에 중복된 한자입니다");
    expect(result.rows[1].status).toBe("blocked");
    expect(result.rows[1].reasons).toContain("입력 내에 중복된 한자입니다");
  });

  it("선택 탭에 이미 있는 한자는 duplicate", () => {
    const result = validateRegistrationInput(
      batch([{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }]),
      new Set(["经济"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({
      hanzi: "经济",
      pinyin: "jīngjì",
      meaning: "경제",
      status: "duplicate",
      reasons: ["선택한 탭에 이미 있는 한자입니다"],
    });
  });

  it("existingHanziInTab에 없으면(다른 탭 소속 등) 중복으로 취급하지 않는다", () => {
    const result = validateRegistrationInput(
      batch([{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }]),
      new Set(["다른한자"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
  });

  it("우선순위: 형식 오류가 있으면 시트 중복이어도 blocked로 분류한다", () => {
    const result = validateRegistrationInput(
      batch([{ hanzi: "经济", pinyin: "", meaning: "경제" }]),
      new Set(["经济"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
  });
});

describe("validateNewTabName", () => {
  it("정상 이름이면 null", () => {
    expect(validateNewTabName("HSK7")).toBeNull();
  });

  it("앞뒤 공백은 트림하고 판단한다", () => {
    expect(validateNewTabName("  HSK7  ")).toBeNull();
  });

  it("빈 값(공백만 포함)이면 오류 메시지", () => {
    expect(validateNewTabName("   ")).toBe("탭 이름을 입력하세요");
  });

  it("_로 시작하면 오류 메시지", () => {
    expect(validateNewTabName("_보류")).toBe("탭 이름은 _로 시작할 수 없습니다");
  });
});
