/**
 * POST /api/words/register 재검증 로직 — 단어 등록 시스템 플랜(`docs/plans/word-registration-system.md`)
 * §3 스키마·§6 탭 이름 규칙을 Sheets 호출 없이 순수 함수로 검증한다.
 */

export interface RegisterWord {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

/** 플랜 §6·PRD §7.3: 한 요청의 words 배열은 최대 이 건수까지만 허용한다(#57). */
export const MAX_REGISTER_WORDS = 100;

/**
 * 한자 유니코드 범위(플랜 §3, 기본 블록만 허용) — src/lib/registerValidation.ts의 HANZI_RE와
 * 동일해야 드리프트가 없다(#57). CJK 확장 A(U+3400–)는 의도적으로 제외.
 */
export const HANZI_RE = /^[一-鿿]+$/u;

/**
 * 병음 성조 부호 형식(플랜 §3 "성조 부호 필수, 숫자 표기 불가") — docs/registration-kit/schema_check.py의
 * 동명 검사를 라이브러리 없이 이식한다(#57). 한자-병음 의미적 일치는 여기서 보지 않는다 — pinyin-pro는
 * 클라이언트(src/lib/pinyinValidation.ts) 전용으로 유지한다.
 */
const TONED_VOWELS = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ";
// 표준 병음은 'v'를 쓰지 않는다 — ü의 키보드 대체 문자일 뿐이라 스키마가 ü 표기를 요구한다.
const ALLOWED_PINYIN_CHARS = new Set(`abcdefghijklmnopqrstuwxyzü'’ ${TONED_VOWELS}`);
const TONE_MARK_RE = new RegExp(`[${TONED_VOWELS}]`, "u");

function hasValidToneFormat(pinyin: string): boolean {
  const lower = pinyin.toLowerCase();
  if (/\d/.test(lower)) {
    return false;
  }
  for (const ch of lower) {
    if (!ALLOWED_PINYIN_CHARS.has(ch)) {
      return false;
    }
  }
  return TONE_MARK_RE.test(lower);
}

/** words 배열을 플랜 §3 스키마로 재검증한다. 필드 누락·빈 문자열·타입 불일치·한자 유니코드 범위 밖·
 * 병음 성조 형식 위반·배열 내 한자 중복·100건 초과면 null. */
export function parseRegisterWords(raw: unknown): RegisterWord[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REGISTER_WORDS) {
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
    if (!HANZI_RE.test(word.hanzi) || !hasValidToneFormat(word.pinyin)) {
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
