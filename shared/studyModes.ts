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
