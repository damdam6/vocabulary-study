/** A user's selected modes are study preferences, not authorization capabilities. */
export type StudyMode = 'm1' | 'm2' | 'm3';
export function isStudyModes(value: unknown): value is StudyMode[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 3
    && value.every((mode) => mode === 'm1' || mode === 'm2' || mode === 'm3')
    && new Set(value).size === value.length;
}
export function effectiveModes(
  word: { studyModes?: readonly StudyMode[] }, defaults: readonly StudyMode[],
): readonly StudyMode[] {
  return word.studyModes ?? defaults;
}

/**
 * `THES.` 접두 탭(점 뒤 공백 무관)은 유의어 고르기(m3) 전용 탭이다. 열 계약이 일반 탭과 다르다:
 * A 원문 · B 병음 · C 뜻 · D 유의어 그룹 · E m3 정답 수 · F 복습 · G~ 타임스탬프.
 */
export function isSynonymTab(name: string): boolean {
  return /^THES\./.test(name.trim());
}
/** THES 탭은 m3로 고정, 일반 탭은 m3를 쓸 수 없다. */
export const SYNONYM_TAB_MODES: readonly StudyMode[] = ['m3'];
export function modesAllowedForTab(name: string, modes: readonly StudyMode[]): boolean {
  return isSynonymTab(name)
    ? modes.length === 1 && modes[0] === 'm3'
    : !modes.includes('m3');
}

export interface SynonymCandidate {
  tab: string;
  hanzi: string;
  meaning: string;
  synonymGroup?: string;
}
/**
 * 같은 탭·같은 유의어 그룹에서 오답 보기로 쓸 수 있는 단어. 뜻이 같은 단어는 정답과
 * 구분이 안 되므로 빼고, 뜻이 겹치는 보기끼리도 하나만 남긴다.
 */
export function synonymDistractors<T extends SynonymCandidate>(word: T, words: readonly T[]): T[] {
  const group = word.synonymGroup?.trim();
  if (!group) return [];
  const seen = new Set([word.meaning.trim()]);
  return words.filter((other) => {
    if (other.tab !== word.tab || other.hanzi === word.hanzi || other.synonymGroup?.trim() !== group) return false;
    const meaning = other.meaning.trim();
    if (seen.has(meaning)) return false;
    seen.add(meaning);
    return true;
  });
}

export interface TabModeSetting {
  id: number;
  name: string;
  modes: StudyMode[];
  explicit: boolean;
}
