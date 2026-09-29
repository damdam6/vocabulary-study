import { isStudyModes, type TabModeSetting } from '../../shared/studyModes.ts';
import { apiFetch } from './api.ts';

export async function tabModesRequest(tabs?: Pick<TabModeSetting, 'id' | 'modes'>[], signal?: AbortSignal): Promise<TabModeSetting[]> {
  const response = await apiFetch('/api/tab-modes', tabs ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tabs }), signal,
  } : { signal });
  const body = await response.json() as { tabs?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error ?? '탭별 설정을 불러오거나 저장하지 못했습니다.');
  if (!Array.isArray(body.tabs) || body.tabs.some((tab) => !tab || !Number.isInteger(tab.id)
    || tab.id < 0 || typeof tab.name !== 'string' || typeof tab.explicit !== 'boolean' || !isStudyModes(tab.modes))
    || new Set(body.tabs.map((tab) => tab.id)).size !== body.tabs.length) {
    throw new Error('탭별 설정 응답이 올바르지 않습니다.');
  }
  return body.tabs as TabModeSetting[];
}
