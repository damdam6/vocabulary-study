import { isStudyModes, type StudyMode } from '../../shared/studyModes.ts';
import type { Profile } from '../lib/profiles.ts';
import { addSheet, appendValues } from '../lib/sheets.ts';
import { SETTINGS_RANGE, SETTINGS_TAB } from '../lib/settings.ts';
import { readTabModes, tabModesKey } from '../lib/tabModes.ts';

export async function handleTabModes(request: Request, env: Env, profile: Profile): Promise<Response> {
  if (request.method === 'GET') {
    const { tabs } = await readTabModes(env, profile);
    return Response.json({ tabs }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: '잘못된 JSON입니다.' }, { status: 400 }); }
  const entries = (body as { tabs?: unknown } | null)?.tabs;
  if (!Array.isArray(entries) || entries.some((item) => !item || !Number.isInteger(item.id)
    || item.id < 0 || !isStudyModes(item.modes)) || new Set(entries.map((item) => item.id)).size !== entries.length) {
    return Response.json({ error: '각 탭에 뜻 보기 또는 쓰기를 하나 이상 선택하세요.' }, { status: 400 });
  }
  const { tabs, hasSettings } = await readTabModes(env, profile);
  const current = new Map(tabs.map((tab) => [tab.id, tab]));
  if (entries.some((item) => !current.has(item.id))) {
    return Response.json({ error: '탭이 변경되었습니다. 다시 불러와 주세요.' }, { status: 409 });
  }
  // Patch submitted tabs, retain other active tabs, omit deleted IDs from the new snapshot.
  const saved: Record<string, StudyMode[]> = Object.fromEntries(tabs.filter((tab) => tab.explicit).map((tab) => [tab.id, tab.modes]));
  for (const item of entries) saved[String(item.id)] = item.modes;
  if (!hasSettings) await addSheet(env, profile.sheetId, SETTINGS_TAB);
  await appendValues(env, profile.sheetId, SETTINGS_TAB, SETTINGS_RANGE, [[tabModesKey(profile.id), JSON.stringify(saved)]]);
  return Response.json({ tabs: tabs.map((tab) => ({ ...tab, modes: saved[String(tab.id)] ?? tab.modes, explicit: Object.hasOwn(saved, String(tab.id)) })) });
}
