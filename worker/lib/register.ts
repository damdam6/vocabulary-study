/**
 * POST /api/words/register 재검증 로직 — 단어 등록 시스템 플랜(`docs/plans/word-registration-system.md`)
 * §3 스키마·§6 탭 이름 규칙을 Sheets 호출 없이 순수 함수로 검증한다.
 */

export interface RegisterWord {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

/** words 배열을 플랜 §3 스키마로 재검증한다. 필드 누락·빈 문자열·타입 불일치·배열 내 한자 중복이면 null. */
export function parseRegisterWords(raw: unknown): RegisterWord[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const words: RegisterWord[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const { hanzi, pinyin, meaning } = item as Record<string, unknown>;
    if (typeof hanzi !== "string" || typeof pinyin !== "string" || typeof meaning !== "string") {
      return null;
    }
    const word = { hanzi: hanzi.trim(), pinyin: pinyin.trim(), meaning: meaning.trim() };
    if (!word.hanzi || !word.pinyin || !word.meaning) {
      return null;
    }
    if (seen.has(word.hanzi)) {
      return null;
    }
    seen.add(word.hanzi);
    words.push(word);
  }
  return words;
}

export type TabNameResult = { name: string } | { error: string };

/** 탭 이름 규칙(플랜 §6): 앞뒤 공백 트림, `_` 시작 차단, 트림 후 빈 문자열 차단. */
export function normalizeTabName(raw: unknown): TabNameResult {
  if (typeof raw !== "string") {
    return { error: "tab은 문자열이어야 합니다" };
  }
  const name = raw.trim();
  if (!name) {
    return { error: "탭 이름이 비어 있습니다" };
  }
  if (name.startsWith("_")) {
    return { error: "탭 이름은 _로 시작할 수 없습니다" };
  }
  return { name };
}

export interface PartitionResult {
  toAdd: RegisterWord[];
  skipped: string[];
}

/** 탭 내 A열 중복 한자는 스킵한다 — 기존 행은 어떤 경우에도 수정하지 않는다(플랜 §6). */
export function partitionByExisting(words: RegisterWord[], existingHanzi: string[]): PartitionResult {
  const existing = new Set(existingHanzi);
  const toAdd: RegisterWord[] = [];
  const skipped: string[] = [];
  for (const word of words) {
    if (existing.has(word.hanzi)) {
      skipped.push(word.hanzi);
    } else {
      toAdd.push(word);
    }
  }
  return { toAdd, skipped };
}
