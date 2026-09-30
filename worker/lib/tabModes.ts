import { isStudyModes, type StudyMode, type TabModeSetting } from '../../shared/studyModes.ts';
import type { Profile } from './profiles.ts';
import { getSheetMetadata, getValues } from './sheets.ts';
import { SETTINGS_TAB, SETTINGS_RANGE } from './settings.ts';

export function tabModesKey(profileId: string): string {
  return `탭출제유형:${profileId}`;
}

export async function readTabModes(env: Env, profile: Profile) {
  const sheets = await getSheetMetadata(env, profile.sheetId);
  const hasSettings = sheets.some((sheet) => sheet.name === SETTINGS_TAB);
  // Unlike sessionLimit, a failed mode read must not silently change graduation rules.
  const rows = hasSettings ? await getValues(env, profile.sheetId, SETTINGS_TAB, SETTINGS_RANGE) : [];
  const key = tabModesKey(profile.id);
  // Last complete row wins: appending is atomic and does not overwrite other profiles/settings.
  const raw = rows.findLast((row) => row[0] === key)?.[1];
  let stored: Record<string, StudyMode[]> = {};
  if (raw !== undefined) {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Object.entries(parsed).every(([id, modes]) => /^\d+$/.test(id) && isStudyModes(modes))) {
      throw new Error('Invalid tab mode settings');
    }
    stored = parsed as Record<string, StudyMode[]>;
  }
  const tabs: TabModeSetting[] = sheets.filter((sheet) => !sheet.name.startsWith('_')).map((sheet) => ({
    ...sheet, modes: stored[String(sheet.id)] ?? profile.modes,
    explicit: Object.hasOwn(stored, String(sheet.id)),
  }));
  return { tabs, hasSettings };
}

/** New clients retain the session's modes, including on retry; legacy clients use current settings. */
export async function resolveRecordModes(env: Env, profile: Profile, tab: string, snapshot?: StudyMode[]) {
  const { tabs } = await readTabModes(env, profile);
  const found = tabs.find((entry) => entry.name === tab);
  return found ? (snapshot ?? found.modes) : null;
}
