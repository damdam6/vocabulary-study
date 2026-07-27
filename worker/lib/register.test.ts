import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_HEADERS, HANZI_RE, MAX_REGISTER_WORDS, normalizeTabName, parseRegisterWords, partitionByExisting } from "./register.ts";
// worker/lib과 src/lib은 별도 tsconfig 프로젝트(tsconfig.worker.json/tsconfig.app.json)라 TS import로
// 직접 비교할 수 없다 — vite/client가 제공하는 ?raw로 소스를 문자열째 읽어 리터럴 일치를 확인한다.
import clientRegisterValidationSource from "../../src/lib/registerValidation.ts?raw";

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

  it("정확히 100건이면 통과한다", () => {
    const words = Array.from({ length: MAX_REGISTER_WORDS }, (_, i) => ({
      hanzi: String.fromCodePoint(0x4e00 + i),
      pinyin: "jīngjì",
      meaning: "경제",
    }));
    const result = parseRegisterWords(words);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(MAX_REGISTER_WORDS);
  });

  it("100건을 초과하면 null", () => {
    const words = Array.from({ length: MAX_REGISTER_WORDS + 1 }, () => ({
      hanzi: "经济",
      pinyin: "jīngjì",
      meaning: "경제",
    }));
    expect(parseRegisterWords(words)).toBeNull();
  });

  it("한자가 기본 블록(U+4E00–U+9FFF) 밖이면(CJK 확장 A 등) null", () => {
    expect(parseRegisterWords([{ hanzi: "㐀", pinyin: "jīngjì", meaning: "경제" }])).toBeNull();
  });

  it("한자에 비한자 문자가 섞이면 null", () => {
    expect(parseRegisterWords([{ hanzi: "abc经", pinyin: "jīngjì", meaning: "경제" }])).toBeNull();
  });

  it("병음이 숫자 성조 표기면 null", () => {
    expect(parseRegisterWords([{ hanzi: "经济", pinyin: "jing1ji4", meaning: "경제" }])).toBeNull();
  });

  it("병음에 성조 부호가 전혀 없으면 null", () => {
    expect(parseRegisterWords([{ hanzi: "经济", pinyin: "jingji", meaning: "경제" }])).toBeNull();
  });

  it("병음에 허용되지 않는 문자가 섞이면 null", () => {
    expect(parseRegisterWords([{ hanzi: "经济", pinyin: "jīngjì!", meaning: "경제" }])).toBeNull();
  });
});

describe("parseRegisterWords — generic (등록 일반화 플랜 §3.2)", () => {
  it("A열 자유 텍스트(공백·문장부호·한자 혼입)와 B열 빈 문자열을 트림된 형태로 허용한다", () => {
    const result = parseRegisterWords(
      [
        { hanzi: " take off ", pinyin: "", meaning: " 이륙하다 " },
        { hanzi: "abc经!", pinyin: " 구동사 ", meaning: "예문" },
      ],
      "generic",
    );
    expect(result).toEqual([
      { hanzi: "take off", pinyin: "", meaning: "이륙하다" },
      { hanzi: "abc经!", pinyin: "구동사", meaning: "예문" },
    ]);
  });

  it("zh 범위 밖 문자(U+3400 등)·무성조 병음도 통과한다 — zh 규칙 미적용", () => {
    const result = parseRegisterWords([{ hanzi: "㐀", pinyin: "jingji", meaning: "뜻" }], "generic");
    expect(result).toEqual([{ hanzi: "㐀", pinyin: "jingji", meaning: "뜻" }]);
  });

  it("pinyin 필드가 누락되거나 문자열이 아니면 null — 와이어 계약(§3.3)상 필드 자체는 필수", () => {
    expect(parseRegisterWords([{ hanzi: "take off", meaning: "이륙하다" }], "generic")).toBeNull();
    expect(parseRegisterWords([{ hanzi: "take off", pinyin: 1, meaning: "이륙하다" }], "generic")).toBeNull();
  });

  it("hanzi(표제어)가 트림 후 빈 문자열이면 null", () => {
    expect(parseRegisterWords([{ hanzi: "  ", pinyin: "", meaning: "이륙하다" }], "generic")).toBeNull();
  });

  it("meaning이 트림 후 빈 문자열이면 null", () => {
    expect(parseRegisterWords([{ hanzi: "take off", pinyin: "", meaning: " " }], "generic")).toBeNull();
  });

  it("배치 내 표제어 중복(정확 일치)은 null, 대소문자가 다르면 별개 표제어다(§8 Q4)", () => {
    const dup = [
      { hanzi: "take off", pinyin: "", meaning: "이륙하다" },
      { hanzi: "take off", pinyin: "구동사", meaning: "벗다" },
    ];
    expect(parseRegisterWords(dup, "generic")).toBeNull();

    const caseDiff = [
      { hanzi: "take off", pinyin: "", meaning: "이륙하다" },
      { hanzi: "Take off", pinyin: "", meaning: "이륙하다" },
    ];
    expect(parseRegisterWords(caseDiff, "generic")).toHaveLength(2);
  });

  it("정확히 100건이면 통과, 초과면 null", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ hanzi: `expr ${i}`, pinyin: "", meaning: "뜻" }));
    expect(parseRegisterWords(make(MAX_REGISTER_WORDS), "generic")).toHaveLength(MAX_REGISTER_WORDS);
    expect(parseRegisterWords(make(MAX_REGISTER_WORDS + 1), "generic")).toBeNull();
  });

  it("generic 완화가 zh에 새지 않는다 — 명시적 'zh'는 자유 텍스트·빈 병음·무성조를 여전히 거부한다", () => {
    expect(parseRegisterWords([{ hanzi: "take off", pinyin: "tā", meaning: "뜻" }], "zh")).toBeNull();
    expect(parseRegisterWords([{ hanzi: "经济", pinyin: "", meaning: "경제" }], "zh")).toBeNull();
    expect(parseRegisterWords([{ hanzi: "经济", pinyin: "jingji", meaning: "경제" }], "zh")).toBeNull();
  });
});

describe("DEFAULT_TAB_HEADERS", () => {
  it("contentType별 A~F 6열 헤더를 제공한다(등록 일반화 플랜 §3.3)", () => {
    expect(DEFAULT_TAB_HEADERS.zh).toEqual(["한자", "병음", "뜻", "모드1", "모드2", "복습"]);
    expect(DEFAULT_TAB_HEADERS.generic).toEqual(["표제어", "보조 표기", "뜻", "모드1", "모드2", "복습"]);
  });
});

describe("HANZI_RE", () => {
  it("src/lib/registerValidation.ts의 HANZI_RE와 동일한 정규식 리터럴을 쓴다(#57 드리프트 예방)", () => {
    expect(clientRegisterValidationSource).toContain(`const HANZI_RE = ${HANZI_RE.toString()};`);
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
