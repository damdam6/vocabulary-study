/** #172 PRD §3: zh 등록 형식 계약. 의미적 병음 일치나 기존 시트 읽기에는 적용하지 않는다. */
export const MAX_REGISTER_WORDS = 100;
export const MAX_HANZI_CODE_POINTS = 200;
export const MAX_PINYIN_CODE_POINTS = 1_000;
export const REGISTRATION_PUNCTUATION = `，。！？；：、,.!?;:（）()【】[]《》〈〉“”‘’「」『』"'…—-·／/％%＋+＝=．`;

export interface RegistrationWord {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

export interface RegistrationIssue {
  field: keyof RegistrationWord;
  code: "invalid_type" | "required" | "invalid_character" | "too_long" | "missing_hanzi" | "missing_tone";
}

export type ZhRegistrationResult =
  | { ok: true; word: RegistrationWord }
  | { ok: false; issues: RegistrationIssue[] };

const HANZI = /[\u4e00-\u9fff]/u;
const HANZI_CHARACTER = /^[\u4e00-\u9fffA-Za-z0-9Ａ-Ｚａ-ｚ０-９]$/u;
const TONED_VOWELS = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ";
const PINYIN_CHARACTERS = new Set(`abcdefghijklmnopqrstuvwxyzü${TONED_VOWELS}`);
const TONE_MARK = new RegExp(`[${TONED_VOWELS}]`, "u");
const SEPARATORS = new Set(` \u3000${REGISTRATION_PUNCTUATION}`);

/** 신규 저장 값과 zh 중복 비교용 키. 기존 행/학습 기록의 원문 키를 대체하지 않는다. */
export function normalizeRegistrationText(value: string): string {
  return value.normalize("NFC").trim();
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** 원본 문자 검사를 trim보다 먼저 수행하여 양끝의 탭·개행·불허 공백도 차단한다. */
export function validateZhRegistrationWord(raw: unknown): ZhRegistrationResult {
  const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const word: RegistrationWord = { hanzi: "", pinyin: "", meaning: "" };
  const issues: RegistrationIssue[] = [];
  for (const field of ["hanzi", "pinyin", "meaning"] as const) {
    const value = item[field];
    if (typeof value !== "string") {
      issues.push({ field, code: "invalid_type" });
      continue;
    }
    // 뜻은 기존 trim-only 계약을 유지한다.
    const normalized = field === "meaning" ? value : value.normalize("NFC");
    word[field] = normalized.trim();
    if (!word[field]) issues.push({ field, code: "required" });
    if (field === "meaning") continue;

    const allowed = (ch: string) => SEPARATORS.has(ch) || (field === "hanzi"
      ? HANZI_CHARACTER.test(ch)
      : PINYIN_CHARACTERS.has(ch.toLowerCase()));
    if (Array.from(normalized).some((ch) => !allowed(ch))) {
      issues.push({ field, code: "invalid_character" });
    }
    const max = field === "hanzi" ? MAX_HANZI_CODE_POINTS : MAX_PINYIN_CODE_POINTS;
    if (codePointLength(word[field]) > max) issues.push({ field, code: "too_long" });
    if (word[field] && field === "hanzi" && !HANZI.test(word.hanzi)) {
      issues.push({ field, code: "missing_hanzi" });
    }
    if (word[field] && field === "pinyin" && !TONE_MARK.test(word.pinyin.toLowerCase())) {
      issues.push({ field, code: "missing_tone" });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, word };
}
