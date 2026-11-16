import { isStudyModes, type StudyMode, type TabModeSetting } from '../../shared/studyModes.ts';
import type { Profile } from './profiles.ts';
import { batchGetValues, getSheetMetadata, getValues, type RangeRef } from './sheets.ts';
import { SETTINGS_TAB, SETTINGS_RANGE } from './settings.ts';

export function tabModesKey(profileId: string): string {
  return `탭출제유형:${profileId}`;
}

interface SheetMeta {
  id: number;
  name: string;
}

function buildTabs(sheets: SheetMeta[], settingsRows: string[][], profile: Profile): TabModeSetting[] {
  const key = tabModesKey(profile.id);
  // Last complete row wins: appending is atomic and does not overwrite other profiles/settings.
  const raw = settingsRows.findLast((row) => row[0] === key)?.[1];
  let stored: Record<string, StudyMode[]> = {};
  if (raw !== undefined) {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Object.entries(parsed).every(([id, modes]) => /^\d+$/.test(id) && isStudyModes(modes))) {
      throw new Error('Invalid tab mode settings');
    }
    stored = parsed as Record<string, StudyMode[]>;
  }
  return sheets.filter((sheet) => !sheet.name.startsWith('_')).map((sheet) => ({
    ...sheet, modes: stored[String(sheet.id)] ?? profile.modes,
    explicit: Object.hasOwn(stored, String(sheet.id)),
  }));
}

export async function readTabModes(env: Env, profile: Profile) {
  const sheets = await getSheetMetadata(env, profile.sheetId);
  const hasSettings = sheets.some((sheet) => sheet.name === SETTINGS_TAB);
  // Unlike sessionLimit, a failed mode read must not silently change graduation rules.
  const rows = hasSettings ? await getValues(env, profile.sheetId, SETTINGS_TAB, SETTINGS_RANGE) : [];
  return { tabs: buildTabs(sheets, rows, profile), hasSettings };
}

/**
 * 탭 모드와 호출자가 필요한 추가 범위를 읽기 2회(메타데이터 + batchGet)로 함께 가져온다.
 * Sheets 읽기 쿼터가 요청 수 기준(분당 60회/사용자)이라 홈 조회·정답 기록처럼 잦은 경로는
 * 범위마다 따로 읽지 않고 이걸 쓴다. extraRanges는 `_` 접두를 뺀 학습 탭 목록을 받아
 * 읽을 범위를 고르고, extra는 그 순서대로의 값이다.
 */
export async function readTabModesWith(
  env: Env,
  profile: Profile,
  extraRanges: (wordTabs: string[]) => RangeRef[],
) {
  const sheets = await getSheetMetadata(env, profile.sheetId);
  const hasSettings = sheets.some((sheet) => sheet.name === SETTINGS_TAB);
  const wordTabs = sheets.filter((sheet) => !sheet.name.startsWith('_')).map((sheet) => sheet.name);
  const settingsRange: RangeRef[] = hasSettings ? [{ tab: SETTINGS_TAB, range: SETTINGS_RANGE }] : [];
  const values = await batchGetValues(env, profile.sheetId, [...settingsRange, ...extraRanges(wordTabs)]);
  const settingsRows = hasSettings ? values[0] : [];
  return {
    tabs: buildTabs(sheets, settingsRows, profile),
    hasSettings,
    settingsRows,
    extra: values.slice(settingsRange.length),
  };
}

/**
 * 기록 경로(정답·복습 실패) 공용: 탭 모드와 대상 탭 전체를 읽기 2회로 가져와 A열 한자로 행을 찾는다.
 * 행 번호는 캐시하지 않고 매 요청 재탐색한다(PRD 4.2). 탭이 없으면 null, 단어가 없으면 row가 null.
 */
export async function readRecordTarget(
  env: Env,
  profile: Profile,
  tab: string,
  hanzi: string,
  snapshot?: StudyMode[],
) {
  const { tabs, extra } = await readTabModesWith(env, profile, (wordTabs) =>
    wordTabs.includes(tab) ? [{ tab }] : []);
  const found = tabs.find((entry) => entry.name === tab);
  if (!found) return null;
  const sheetRows = extra[0] ?? [];
  // index 0은 헤더(1행)이므로 건너뛴다 — 배열 인덱스 + 1이 시트 행 번호.
  const index = sheetRows.findIndex((row, i) => i >= 1 && row[0] === hanzi);
  return {
    modes: snapshot ?? found.modes,
    row: index === -1 ? null : { rowNumber: index + 1, values: sheetRows[index] },
  };
}
