/**
 * 붙여넣은 등록 배치를 검증해 정상/오류(차단)/중복 행으로 분류한다 (단어 등록
 * 시스템 플랜 §3 스키마, §5-2 기계 검토, #49). 시트 중복 대조는 "선택 탭 기준"
 * (이슈 #49 본문) — 호출부(RegisterScreen)가 현재 선택된 탭의 기존 한자 집합만
 * 골라 넘긴다. 이 모듈은 WordEntry/탭 개념을 몰라도 되게 문자열 집합만 받는다.
 *
 * 분류 우선순위: 오류(형식·병음불일치·빈 값·입력 내 중복) > 중복(시트 내). 입력
 * 내 중복 한자는 어느 쪽이 진짜인지 판별 불가하므로 시트-중복보다 먼저 차단한다.
 */

import { isPinyinMatch } from "./pinyinValidation";

export interface ParsedWord {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

export type RowStatus = "valid" | "blocked" | "duplicate";

export interface ValidatedRow extends ParsedWord {
  status: RowStatus;
  /** blocked·duplicate 사유. valid는 빈 배열. */
  reasons: string[];
}

export type RegisterValidationResult =
  | { ok: false; error: string }
  | { ok: true; rows: ValidatedRow[] };

// 한자 유니코드 범위(플랜 §3, 기본 블록만 허용) — worker/lib/register.ts HANZI_RE와
// 동일해야 드리프트가 없다(#57). CJK 확장 A(U+3400–)는 의도적으로 제외.
const HANZI_RE = /^[一-鿿]+$/u;

function stringField(obj: unknown, key: string): string {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

/** 파싱 원본 하나에서 hanzi/pinyin/meaning을 안전하게 뽑아 트림한다. */
function extract(raw: unknown): ParsedWord {
  return {
    hanzi: stringField(raw, "hanzi"),
    pinyin: stringField(raw, "pinyin"),
    meaning: stringField(raw, "meaning"),
  };
}

export function validateRegistrationInput(
  rawText: string,
  existingHanziInTab: ReadonlySet<string>,
): RegisterValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "JSON으로 읽을 수 없습니다. 형식을 확인하세요." };
  }

  if (parsed === null || typeof parsed !== "object" || !("words" in parsed) || !Array.isArray((parsed as { words: unknown }).words)) {
    return { ok: false, error: "words 배열이 없습니다." };
  }
  const body = parsed as { version?: unknown; words: unknown[] };
  if (body.version !== 1) {
    return { ok: false, error: "지원하지 않는 스키마 버전입니다 (version: 1 필요)." };
  }
  if (body.words.length === 0) {
    return { ok: false, error: "words 배열이 비어 있습니다." };
  }

  const hanziCounts = new Map<string, number>();
  for (const raw of body.words) {
    const { hanzi } = extract(raw);
    if (hanzi !== "") hanziCounts.set(hanzi, (hanziCounts.get(hanzi) ?? 0) + 1);
  }

  const rows: ValidatedRow[] = body.words.map((raw): ValidatedRow => {
    const { hanzi, pinyin, meaning } = extract(raw);
    const hanziValid = hanzi !== "" && HANZI_RE.test(hanzi);

    const reasons: string[] = [];
    if (hanzi === "") reasons.push("한자가 비어 있습니다");
    else if (!hanziValid) reasons.push("한자 유니코드 범위를 벗어난 문자가 있습니다");
    if (pinyin === "") reasons.push("병음이 비어 있습니다");
    if (meaning === "") reasons.push("뜻이 비어 있습니다");
    if (hanziValid && pinyin !== "" && !isPinyinMatch(hanzi, pinyin)) {
      reasons.push("한자와 병음이 일치하지 않습니다");
    }
    if (hanzi !== "" && (hanziCounts.get(hanzi) ?? 0) > 1) {
      reasons.push("입력 내에 중복된 한자입니다");
    }

    if (reasons.length > 0) {
      return { hanzi, pinyin, meaning, status: "blocked", reasons };
    }
    if (existingHanziInTab.has(hanzi)) {
      return { hanzi, pinyin, meaning, status: "duplicate", reasons: ["선택한 탭에 이미 있는 한자입니다"] };
    }
    return { hanzi, pinyin, meaning, status: "valid", reasons: [] };
  });

  return { ok: true, rows };
}

/**
 * 새 탭 이름 클라이언트 선검증(트림 후 빈 값·`_` 시작 차단) — UX 개선 목적이고
 * 최종 강제는 Worker(#48) 책임(플랜 §2 신뢰 경계, §5-4, §6). 유효하면 null.
 */
export function validateNewTabName(rawName: string): string | null {
  const name = rawName.trim();
  if (name === "") return "탭 이름을 입력하세요";
  if (name.startsWith("_")) return "탭 이름은 _로 시작할 수 없습니다";
  return null;
}
