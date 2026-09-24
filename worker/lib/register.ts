/**
 * POST /api/words/register 재검증 로직 — 단어 등록 시스템 플랜(`docs/plans/word-registration-system.md`)
 * §3 스키마·§6 탭 이름 규칙을 Sheets 호출 없이 순수 함수로 검증한다.
 * generic 분기·기본 헤더는 등록 일반화 플랜(`docs/plans/registration-generalization.md`) §3.2·§3.3이 원본 —
 * 필드명은 contentType 무관 단일 형태(hanzi/pinyin/meaning = A/B/C열 운반자, §8 Q2).
 */

import type { ContentType } from "./profiles.ts";

import { MAX_REGISTER_WORDS, normalizeRegistrationText, validateZhRegistrationWord } from "../../shared/registration.ts";
import type { RegistrationWord } from "../../shared/registration.ts";

export { MAX_REGISTER_WORDS } from "../../shared/registration.ts";
export type RegisterWord = RegistrationWord;

/** zh: #172 PRD §3 공통 형식 검사. generic: 기존 trim·필수 필드 계약 유지.
 * 배열/null 반환과 100건 제한은 기존 API와 같다. 병음 의미 일치는 검사하지 않는다. */
export function parseRegisterWords(raw: unknown, contentType: ContentType = "zh"): RegisterWord[] | null {
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
    let word: RegisterWord;
    if (contentType === "zh") {
      const result = validateZhRegistrationWord(item);
      if (!result.ok) return null;
      word = result.word;
    } else {
      word = { hanzi: hanzi.trim(), pinyin: pinyin.trim(), meaning: meaning.trim() };
      if (!word.hanzi || !word.meaning) return null;
    }
    if (seen.has(word.hanzi)) {
      return null;
    }
    seen.add(word.hanzi);
    words.push(word);
  }
  return words;
}

/** 탭 0개 부트스트랩(등록 일반화 플랜 §3.3)용 contentType별 기본 헤더 — A~F만, G열 이후는
 * 타임스탬프 append 영역이라 헤더를 두지 않는다. 헤더 행은 표시용일 뿐(전 탭 1행 스킵)
 * 파싱에는 영향이 없다. 문구는 기존 테스트 픽스처 관례의 번안. */
export const DEFAULT_TAB_HEADERS: Record<ContentType, string[]> = {
  zh: ["한자", "병음", "뜻", "모드1", "모드2", "복습"],
  generic: ["표제어", "보조 표기", "뜻", "모드1", "모드2", "복습"],
};

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
export function partitionByExisting(
  words: RegisterWord[], existingHanzi: string[], contentType: ContentType = "zh",
): PartitionResult {
  // 비교용 복사 키만 정규화한다. generic의 기존 시트 정확 일치 정책은 유지한다.
  const key = contentType === "zh" ? normalizeRegistrationText : (value: string) => value;
  const existing = new Set(existingHanzi.map(key));
  const toAdd: RegisterWord[] = [];
  const skipped: string[] = [];
  for (const word of words) {
    if (existing.has(key(word.hanzi))) {
      skipped.push(word.hanzi);
    } else {
      toAdd.push(word);
    }
  }
  return { toAdd, skipped };
}
