/**
 * 탭 관리 화면 전용 API 클라이언트 — GET/POST /api/tab-manage (worker/routes/tab-manage.ts).
 * 탭 생성은 registerApi.ts의 createTab(POST /api/tabs)을 그대로 쓴다.
 */
import { isStudyModes, type ManagedTab, type StudyMode } from '../../shared/studyModes.ts';
import { apiFetch } from './api.ts';

export interface TabManageResult {
  tabs: ManagedTab[];
  /** delete·sync가 `_정보`에서 정리한 낡은 설정 항목 수. */
  removed: number;
}

export interface TabSaveEntry {
  id: number;
  modes: StudyMode[];
  disabled: boolean;
}

export type TabManageAction =
  | { action: 'save'; tabs: TabSaveEntry[]; order?: number[] }
  | { action: 'rename'; id: number; name: string }
  | { action: 'delete'; id: number }
  | { action: 'sync' };

function isManagedTab(tab: unknown): tab is ManagedTab {
  if (!tab || typeof tab !== 'object') return false;
  const value = tab as Record<string, unknown>;
  return Number.isInteger(value.id) && (value.id as number) >= 0 && typeof value.name === 'string'
    && typeof value.explicit === 'boolean' && typeof value.disabled === 'boolean'
    && Number.isInteger(value.wordCount) && isStudyModes(value.modes);
}

/** action 없이 부르면 목록 조회(GET), 있으면 그 작업을 수행(POST)한다. */
export async function tabManageRequest(action?: TabManageAction, signal?: AbortSignal): Promise<TabManageResult> {
  const response = await apiFetch('/api/tab-manage', action ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action), signal,
  } : { signal });
  const body = await response.json().catch(() => ({})) as { tabs?: unknown; removed?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error ?? '탭 관리 요청을 처리하지 못했습니다.');
  if (!Array.isArray(body.tabs) || !body.tabs.every(isManagedTab)
    || new Set(body.tabs.map((tab) => tab.id)).size !== body.tabs.length) {
    throw new Error('탭 목록 응답이 올바르지 않습니다.');
  }
  return { tabs: body.tabs, removed: typeof body.removed === 'number' ? body.removed : 0 };
}
