import fixturesSource from "../../tests/fixtures/chinese-sentence-registration.json?raw";
import { PINYIN_REVIEW_WARNING } from "./pinyinValidation";
import { describe, expect, it } from "vitest";
import {
  classifyRegistrationRows,
  parseRegistrationInput,
  validateNewTabName,
  validateRegistrationInput,
} from "./registerValidation";

const EMPTY = new Set<string>();

function batch(words: unknown[], version: unknown = 1, contentType?: string): string {
  return JSON.stringify({ version, ...(contentType !== undefined ? { contentType } : {}), words });
}

function genericBatch(words: unknown[], version: unknown = 1): string {
  return batch(words, version, "generic");
}

describe("validateRegistrationInput", () => {
  it("다음자가 있는 기존 단어도 제출 가능한 warning으로 분류된다", () => {
    const result = validateRegistrationInput(
      batch([{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }]),
      EMPTY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { hanzi: "经济", pinyin: "jīngjì", meaning: "경제", status: "warning", reasons: [], warnings: [PINYIN_REVIEW_WARNING] },
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
    const result = validateRegistrationInput(batch([{ hanzi: "😀经", pinyin: "jīngjì", meaning: "경제" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("한자에 허용되지 않는 문자가 있습니다 (탭·개행·제어문자 포함)");
  });

  it("한자와 병음이 일치하지 않아도 warning", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "经济", pinyin: "nǐhǎo", meaning: "경제" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("warning");
    expect(result.rows[0].warnings).toEqual([PINYIN_REVIEW_WARNING]);
  });

  it("다음자 후보 일치는 문맥 검토 경고다", () => {
    const result = validateRegistrationInput(batch([{ hanzi: "行", pinyin: "háng", meaning: "은행 등에서 쓰는 항" }]), EMPTY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("warning");
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
      warnings: [PINYIN_REVIEW_WARNING],
    });
  });

  it("existingHanziInTab에 없으면(다른 탭 소속 등) 중복으로 취급하지 않는다", () => {
    const result = validateRegistrationInput(
      batch([{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }]),
      new Set(["다른한자"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("warning");
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

describe("validateRegistrationInput — generic contentType", () => {
  it("note를 생략해도 valid — B열 빈칸 허용", () => {
    const result = validateRegistrationInput(genericBatch([{ term: "run into", meaning: "우연히 만나다" }]), EMPTY, "generic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { hanzi: "run into", pinyin: "", meaning: "우연히 만나다", status: "valid", reasons: [] },
    ]);
  });

  it("note가 빈 문자열이어도 valid — B열 빈칸 허용", () => {
    const result = validateRegistrationInput(
      genericBatch([{ term: "run into", note: "", meaning: "우연히 만나다" }]),
      EMPTY,
      "generic",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
  });

  it("term/note/meaning이 운반자 hanzi/pinyin/meaning 자리로 정확히 매핑된다", () => {
    const result = validateRegistrationInput(
      genericBatch([{ term: "take off", note: "구동사", meaning: "이륙하다" }]),
      EMPTY,
      "generic",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({
      hanzi: "take off",
      pinyin: "구동사",
      meaning: "이륙하다",
      status: "valid",
      reasons: [],
    });
  });

  it("term이 비어 있으면 blocked", () => {
    const result = validateRegistrationInput(genericBatch([{ term: "", note: "", meaning: "이륙하다" }]), EMPTY, "generic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("표제어가 비어 있습니다");
  });

  it("meaning이 비어 있으면 blocked", () => {
    const result = validateRegistrationInput(genericBatch([{ term: "take off", note: "", meaning: "" }]), EMPTY, "generic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("뜻이 비어 있습니다");
  });

  it("배치 내 term이 중복되면 둘 다 blocked", () => {
    const result = validateRegistrationInput(
      genericBatch([
        { term: "take off", meaning: "이륙하다" },
        { term: "take off", meaning: "옷을 벗다" },
      ]),
      EMPTY,
      "generic",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reasons).toContain("입력 내에 중복된 표제어입니다");
    expect(result.rows[1].status).toBe("blocked");
    expect(result.rows[1].reasons).toContain("입력 내에 중복된 표제어입니다");
  });

  it("선택 탭에 이미 있는 표제어는 duplicate", () => {
    const result = validateRegistrationInput(
      genericBatch([{ term: "take off", meaning: "이륙하다" }]),
      new Set(["take off"]),
      "generic",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({
      hanzi: "take off",
      pinyin: "",
      meaning: "이륙하다",
      status: "duplicate",
      reasons: ["선택한 탭에 이미 있는 표제어입니다"],
    });
  });

  it("한자 유니코드 범위 밖 문자·한자 혼입도 term이면 그대로 통과한다 — zh 전용 범위 검사 미적용", () => {
    const result = validateRegistrationInput(genericBatch([{ term: "经济학 abc!", meaning: "혼합 표제어" }]), EMPTY, "generic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
  });

  it("note가 병음처럼 term과 전혀 안 맞아도 차단하지 않는다 — pinyin-pro 미적용", () => {
    const result = validateRegistrationInput(
      genericBatch([{ term: "take off", note: "nǐhǎo", meaning: "이륙하다" }]),
      EMPTY,
      "generic",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
  });

  it("generic 프로필에 contentType 없는 JSON(zh 스키마)을 붙여넣으면 오배치 오류", () => {
    const result = validateRegistrationInput(
      batch([{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }]),
      EMPTY,
      "generic",
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining("zh") });
  });

  it("zh 프로필에 contentType:generic JSON을 붙여넣으면 오배치 오류", () => {
    const result = validateRegistrationInput(
      genericBatch([{ term: "take off", meaning: "이륙하다" }]),
      EMPTY,
      "zh",
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining("generic") });
  });
});

// 등록 화면의 오류 행 직접 수정(#127)은 "파싱 결과를 편집값으로 갈아끼운 뒤 다시
// 분류"하는 구조라, 분류 단계가 rawText 없이 ParsedWord[]만으로 도는 것이 전제다.
describe("parseRegistrationInput / classifyRegistrationRows 분리", () => {
  it("파싱 단계는 zh 원본 A/B를 보존하고 뜻만 트림한다", () => {
    const result = parseRegistrationInput(
      batch([{ hanzi: "  经济  ", pinyin: " jīngjì ", meaning: " 경제 " }]),
    );
    expect(result).toEqual({ ok: true, words: [{ hanzi: "  经济  ", pinyin: " jīngjì ", meaning: "경제" }] });
  });

  it("파싱 단계는 스키마 오류를 그대로 낸다", () => {
    expect(parseRegistrationInput("not json").ok).toBe(false);
    expect(parseRegistrationInput(batch([], 1)).ok).toBe(false);
    expect(parseRegistrationInput(batch([{ hanzi: "经济" }], 2)).ok).toBe(false);
  });

  it("분류 단계는 ParsedWord[]만 받아 정상/오류/중복을 가른다", () => {
    const rows = classifyRegistrationRows(
      [
        { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
        { hanzi: "文化", pinyin: "wénhuà", meaning: "문화" },
        { hanzi: "社会", pinyin: "wrong", meaning: "사회" },
      ],
      new Set(["文化"]),
    );
    expect(rows.map((row) => row.status)).toEqual(["warning", "duplicate", "blocked"]);
  });

  it("입력 내 중복은 매 호출마다 배열 전체 기준으로 다시 집계된다", () => {
    const duplicated = [
      { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
      { hanzi: "经济", pinyin: "jīngjì", meaning: "경제(중복)" },
    ];
    expect(classifyRegistrationRows(duplicated, EMPTY).map((row) => row.status)).toEqual([
      "blocked",
      "blocked",
    ]);

    // 한 행의 한자만 고쳐 다시 분류하면 손대지 않은 짝 행의 중복 오류도 함께 풀린다.
    const fixed = [duplicated[0], { hanzi: "文化", pinyin: "wénhuà", meaning: "문화" }];
    expect(classifyRegistrationRows(fixed, EMPTY).map((row) => row.status)).toEqual(["warning", "warning"]);
  });

  it("generic 분기도 분류 단계만으로 동작한다 — 보조 표기는 비어도 정상", () => {
    const rows = classifyRegistrationRows(
      [
        { hanzi: "take off", pinyin: "", meaning: "이륙하다" },
        { hanzi: "", pinyin: "구동사", meaning: "뜻만 있음" },
      ],
      EMPTY,
      "generic",
    );
    expect(rows[0].status).toBe("valid");
    expect(rows[1].status).toBe("blocked");
    expect(rows[1].reasons).toContain("표제어가 비어 있습니다");
  });

  it("validateRegistrationInput은 두 단계를 이어 붙인 것과 같은 결과를 낸다", () => {
    const raw = batch([
      { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
      { hanzi: "文化", pinyin: "wénhuà", meaning: "문화" },
    ]);
    const existing = new Set(["文化"]);
    const parsed = parseRegistrationInput(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(validateRegistrationInput(raw, existing)).toEqual({
      ok: true,
      rows: classifyRegistrationRows(parsed.words, existing),
    });
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

const fixtures = JSON.parse(fixturesSource) as {
  cases: { id: string; contentType: "zh" | "generic"; words: Record<string, unknown>[]; accepted: boolean; expectedWords?: unknown[] }[];
  partitions: { id: string; contentType: "zh" | "generic"; words: { hanzi: string; pinyin: string; meaning: string }[]; existing: string[]; skipped: string[] }[];
};
describe("#173 공통 fixture parity", () => {
  it.each(fixtures.cases)("$id", (fixture) => {
    const words = fixture.contentType === "generic" ? fixture.words.map((w: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(w).map(([k, v]) => [({ hanzi: "term", pinyin: "note" } as Record<string, string>)[k] ?? k, v]))) : fixture.words;
    const result = validateRegistrationInput(batch(words, 1, fixture.contentType), EMPTY, fixture.contentType);
    expect(result.ok && result.rows.every((r) => r.status !== "blocked")).toBe(fixture.accepted);
    if (result.ok && fixture.accepted) {
      expect(result.rows.map(({ hanzi, pinyin, meaning }) => ({ hanzi, pinyin, meaning }))).toEqual(fixture.expectedWords);
    }
  });
  it.each(fixtures.partitions)("$id", (fixture) => {
    const rows = classifyRegistrationRows(fixture.words, new Set<string>(fixture.existing), fixture.contentType);
    expect(rows.filter((r) => r.status === "duplicate").map((r) => r.hanzi)).toEqual(fixture.skipped);
  });
});

describe("등록 배치 경계와 의미 검토", () => {
  it.each(["zh", "generic"] as const)("%s 100건 허용/101건 차단", (type) => {
    const words = Array.from({ length: 101 }, (_, i) => type === "zh"
      ? { hanzi: `我${i}`, pinyin: "wǒ", meaning: "나" }
      : { term: `item${i}`, meaning: "항목" });
    expect(validateRegistrationInput(batch(words.slice(0, 100), 1, type), EMPTY, type).ok).toBe(true);
    expect(validateRegistrationInput(batch(words, 1, type), EMPTY, type)).toEqual({ ok: false, error: expect.stringContaining("100") });
  });
  it("단일 발음 후보가 있는 항목은 일치/불일치를 구별하되 불일치도 제출 가능", () => {
    const rows = classifyRegistrationRows([
      { hanzi: "今天", pinyin: "jīntiān", meaning: "오늘" },
      { hanzi: "今天。", pinyin: "nǐ hǎo.", meaning: "오늘" },
    ], EMPTY);
    expect(rows.map((r) => r.status)).toEqual(["valid", "warning"]);
    expect(rows[1].warnings?.[0]).toContain("후보와 다릅니다");
  });
  it("직접 수정한 raw 값도 제어문자를 먼저 검사한다", () => {
    const rows = classifyRegistrationRows([{ hanzi: "今天", pinyin: "jīntiān\t", meaning: "오늘" }], EMPTY);
    expect(rows[0].status).toBe("blocked");
  });
});


describe("리뷰 회귀: 형식 오류 행의 중복 집계 격리", () => {
  const word = { hanzi: "今天", pinyin: "jīntiān", meaning: "오늘" };
  it.each(["\t", "\n", "\u00a0", "\ufeff"])("양끝 불허 문자 %j은 자기 행만 차단한다", (control) => {
    for (const hanzi of [control + word.hanzi, word.hanzi + control]) {
      const rows = classifyRegistrationRows([word, { ...word, hanzi }], EMPTY);
      expect(rows.map((row) => row.status)).toEqual(["valid", "blocked"]);
      expect(rows[1].hanzi).toBe(hanzi);
      expect(rows[1].reasons).toEqual([expect.stringContaining("허용되지 않는 문자")]);
    }
  });
  it.each([{ pinyin: "jin1tian1" }, { meaning: "" }])("같은 한자라도 형식 오류가 있는 행은 정상 행을 막지 않는다: %j", (invalid) => {
    expect(classifyRegistrationRows([word, { ...word, ...invalid }], EMPTY).map((r) => r.status)).toEqual(["valid", "blocked"]);
  });
  it("불허 행을 고쳐 저장 가능해지면 배치 중복이 양쪽에 적용된다", () => {
    expect(classifyRegistrationRows([word, { ...word, hanzi: "　今天 " }], EMPTY).map((r) => r.status)).toEqual(["blocked", "blocked"]);
  });
  it("불허 행과 함께 있어도 정상 행의 선택 탭 중복은 유지된다", () => {
    expect(classifyRegistrationRows([word, { ...word, hanzi: "今天\n" }], new Set(["今天"])).map((r) => r.status)).toEqual(["duplicate", "blocked"]);
  });
});
