/** #174 등록 형식 오류 → 중복 → 병음 검토 경고 → 정상 순으로 분류한다.
 * 파싱/편집에서는 zh 원본 A/B를 보존하고 분류할 때만 공통 계약으로 정규화한다.
 * generic의 term/note/meaning은 기존 와이어 운반자 hanzi/pinyin/meaning으로 매핑한다.
 */

import type { ContentType } from "./api";
import { reviewPinyin, PINYIN_REVIEW_WARNING } from "./pinyinValidation";
import { MAX_REGISTER_WORDS, normalizeRegistrationText, validateZhRegistrationWord } from "../../shared/registration";
import type { RegistrationIssue } from "../../shared/registration";

export interface ParsedWord {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

export type RowStatus = "valid" | "warning" | "blocked" | "duplicate";

export interface ValidatedRow extends ParsedWord {
  status: RowStatus;
  /** blocked·duplicate 사유. valid는 빈 배열. */
  reasons: string[];
  /** 의미 검토 안내. 중복 행에도 표시하지만 차단 사유와 구분한다. */
  warnings?: string[];
}

export type RegisterValidationResult =
  | { ok: false; error: string }
  | { ok: true; rows: ValidatedRow[] };

/** 파싱 단계 결과 — 분류 전, 필드만 뽑아낸 상태. */
export type RegisterParseResult =
  | { ok: false; error: string }
  | { ok: true; words: ParsedWord[] };

function stringField(obj: unknown, key: string, trim = true): string {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === "string") return trim ? value.trim() : value;
  }
  return "";
}

/** hanzi/pinyin/meaning 운반자 자리마다 읽어올 소스 필드명. */
type SourceFieldNames = Record<keyof ParsedWord, string>;

/**
 * contentType별 붙여넣기 스키마의 소스 필드명 — zh: hanzi/pinyin/meaning,
 * generic: term/note/meaning → 운반자 자리로 매핑(등록 일반화 플랜 §3.1·§3.3).
 */
const SOURCE_FIELDS: Record<ContentType, SourceFieldNames> = {
  zh: { hanzi: "hanzi", pinyin: "pinyin", meaning: "meaning" },
  generic: { hanzi: "term", pinyin: "note", meaning: "meaning" },
};

/** 파싱 원본에서 필드를 뽑는다. zh A/B는 불허 문자 검사를 위해 raw를 보존한다. */
function extract(raw: unknown, contentType: ContentType): ParsedWord {
  const fields = SOURCE_FIELDS[contentType];
  return {
    hanzi: stringField(raw, fields.hanzi, contentType !== "zh"),
    pinyin: stringField(raw, fields.pinyin, contentType !== "zh"),
    meaning: stringField(raw, fields.meaning),
  };
}

/**
 * 붙여넣은 JSON의 자기서술 contentType과 대상 프로필을 대조해 스키마 오배치를
 * 감지한다(등록 일반화 플랜 §3.1·§3.2, 양방향). zh 스키마는 "필드 없음 = zh"가
 * 원칙이라, zh 프로필 쪽 검사는 정확히 "generic" 값일 때만 차단한다 — 그래야
 * 기존 킷 출력(필드 없음)이나 예상 밖의 값이 오배치로 오분류되지 않는다.
 */
function detectSchemaMismatch(bodyContentType: unknown, contentType: ContentType): string | null {
  if (contentType === "generic" && bodyContentType !== "generic") {
    return "중국어(zh) 스키마로 보입니다 — 이 프로필은 generic 스키마(term/note/meaning)를 사용합니다.";
  }
  if (contentType === "zh" && bodyContentType === "generic") {
    return "generic 스키마로 보입니다 — 이 프로필은 중국어(zh) 스키마(hanzi/pinyin/meaning)를 사용합니다.";
  }
  return null;
}

/** 오류·중복 문구에서 A열/표제어 자리를 가리키는 명사 — zh: 한자, generic: 표제어. */
function headwordNoun(contentType: ContentType): string {
  return contentType === "zh" ? "한자" : "표제어";
}

/**
 * 붙여넣은 텍스트를 ParsedWord[]까지만 끌고 간다 — JSON 파싱, 스키마(버전·words
 * 배열·contentType 오배치) 검사, 필드 추출·트림. 행 분류는 하지 않는다.
 */
export function parseRegistrationInput(
  rawText: string,
  contentType: ContentType = "zh",
): RegisterParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "JSON으로 읽을 수 없습니다. 형식을 확인하세요." };
  }

  if (parsed === null || typeof parsed !== "object" || !("words" in parsed) || !Array.isArray((parsed as { words: unknown }).words)) {
    return { ok: false, error: "words 배열이 없습니다." };
  }
  const body = parsed as { version?: unknown; contentType?: unknown; words: unknown[] };
  if (body.version !== 1) {
    return { ok: false, error: "지원하지 않는 스키마 버전입니다 (version: 1 필요)." };
  }
  if (body.words.length === 0) {
    return { ok: false, error: "words 배열이 비어 있습니다." };
  }
  if (body.words.length > MAX_REGISTER_WORDS) {
    return { ok: false, error: `한 번에 ${MAX_REGISTER_WORDS}건까지 등록할 수 있습니다. 나누어 입력하세요.` };
  }
  const mismatch = detectSchemaMismatch(body.contentType, contentType);
  if (mismatch !== null) {
    return { ok: false, error: mismatch };
  }

  return { ok: true, words: body.words.map((raw) => extract(raw, contentType)) };
}

/**
 * 파싱된 행들을 정상/오류/중복으로 분류한다. 입력 내 중복 카운트(hanziCounts)는
 * 매 호출마다 words 배열 전체 기준으로 다시 집계된다 — 등록 화면이 오류 행을
 * 고쳐 넘길 때(#127) 손대지 않은 짝 행의 중복 오류까지 함께 풀리는 근거다.
 */
export function classifyRegistrationRows(
  words: readonly ParsedWord[],
  existingHanziInTab: ReadonlySet<string>,
  contentType: ContentType = "zh",
): ValidatedRow[] {
  const key = contentType === "zh" ? normalizeRegistrationText : (value: string) => value;
  const existing = new Set(Array.from(existingHanziInTab, key));
  const hanziCounts = new Map<string, number>();
  for (const { hanzi } of words) {
    const normalized = key(hanzi);
    if (normalized) hanziCounts.set(normalized, (hanziCounts.get(normalized) ?? 0) + 1);
  }

  return words.map((raw): ValidatedRow => {
    const reasons: string[] = [];
    const noun = headwordNoun(contentType);
    let word = raw;
    if (contentType === "zh") {
      const result = validateZhRegistrationWord(raw);
      if (result.ok) word = result.word;
      else reasons.push(...result.issues.map(formatIssue));
    } else {
      if (!word.hanzi) reasons.push(`${noun}가 비어 있습니다`);
      if (!word.meaning) reasons.push("뜻이 비어 있습니다");
    }
    if ((hanziCounts.get(key(raw.hanzi)) ?? 0) > 1) {
      reasons.push(`입력 내에 중복된 ${noun}입니다`);
    }
    if (reasons.length) return { ...word, status: "blocked", reasons };

    const review = contentType === "zh" ? reviewPinyin(word.hanzi, word.pinyin) : "match";
    const warnings = review === "match" ? undefined : [review === "mismatch"
      ? "병음이 문자별 발음 후보와 다릅니다. 원문과 함께 확인하세요."
      : PINYIN_REVIEW_WARNING];
    const reviewFields = warnings ? { warnings } : {};
    if (existing.has(key(word.hanzi))) {
      return { ...word, ...reviewFields, status: "duplicate", reasons: [`선택한 탭에 이미 있는 ${noun}입니다`] };
    }
    return { ...word, ...reviewFields, status: warnings ? "warning" : "valid", reasons: [] };
  });
}

function formatIssue({ field, code }: RegistrationIssue): string {
  const label = { hanzi: "한자", pinyin: "병음", meaning: "뜻" }[field];
  switch (code) {
    case "required": return `${label}${field === "hanzi" ? "가" : "이"} 비어 있습니다`;
    case "invalid_type": return `${label}은 문자열이어야 합니다`;
    case "invalid_character": return `${label}에 허용되지 않는 문자가 있습니다 (탭·개행·제어문자 포함)`;
    case "too_long": return `${label}은 ${field === "hanzi" ? "200" : "1,000"}자를 넘을 수 없습니다`;
    case "missing_hanzi": return "중국어 원문에는 한자가 최소 1자 필요합니다";
    case "missing_tone": return "병음에는 성조 부호가 최소 1개 필요합니다";
  }
}

/** 파싱 + 분류를 한 번에 — rawText 하나로 끝내는 기존 호출부용 합성 함수. */
export function validateRegistrationInput(
  rawText: string,
  existingHanziInTab: ReadonlySet<string>,
  contentType: ContentType = "zh",
): RegisterValidationResult {
  const parsed = parseRegistrationInput(rawText, contentType);
  if (!parsed.ok) return parsed;
  return { ok: true, rows: classifyRegistrationRows(parsed.words, existingHanziInTab, contentType) };
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
