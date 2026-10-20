import { isStudyModes, isSynonymTab, modesAllowedForTab, type StudyMode } from '../../shared/studyModes.ts';
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
  if (entries.some((item) => !modesAllowedForTab(current.get(item.id)!.name, item.modes))) {
    return Response.json({ error: '유의어 고르기는 THES 탭에서만, THES 탭은 유의어 고르기만 선택할 수 있습니다.' }, { status: 400 });
  }
  // Patch submitted tabs, retain other active tabs, omit deleted IDs from the new snapshot.
  const saved: Record<string, StudyMode[]> = Object.fromEntries(tabs.filter((tab) => tab.explicit).map((tab) => [tab.id, tab.modes]));
  // THES 탭은 m3 고정이라 설정 행에 남기지 않는다.
  for (const item of entries) if (!isSynonymTab(current.get(item.id)!.name)) saved[String(item.id)] = item.modes;
  if (!hasSettings) await addSheet(env, profile.sheetId, SETTINGS_TAB);
  await appendValues(env, profile.sheetId, SETTINGS_TAB, SETTINGS_RANGE, [[tabModesKey(profile.id), JSON.stringify(saved)]]);
  return Response.json({ tabs: tabs.map((tab) => ({ ...tab, modes: saved[String(tab.id)] ?? tab.modes, explicit: Object.hasOwn(saved, String(tab.id)) })) });
}
