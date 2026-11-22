/** A user's selected modes are study preferences, not authorization capabilities. */
export type StudyMode = 'm1' | 'm2';
export function isStudyModes(value: unknown): value is StudyMode[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2
    && value.every((mode) => mode === 'm1' || mode === 'm2')
    && new Set(value).size === value.length;
}
export function effectiveModes(
  word: { studyModes?: readonly StudyMode[] }, defaults: readonly StudyMode[],
): readonly StudyMode[] {
  return word.studyModes ?? defaults;
}
export interface TabModeSetting {
  id: number;
  name: string;
  modes: StudyMode[];
  explicit: boolean;
}
/** 탭 관리 화면이 다루는 탭 한 개. disabled 탭은 시트에 남지만 홈·학습·등록 목록에서 빠진다. */
export interface ManagedTab extends TabModeSetting {
  disabled: boolean;
  /** 헤더를 뺀 등록 항목 수. */
  wordCount: number;
}
