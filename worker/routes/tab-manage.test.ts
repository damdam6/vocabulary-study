import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEnv, makeRequest } from '../test-utils.ts';
import worker from '../index.ts';
import type { ManagedTab } from '../../shared/studyModes.ts';
import { planTabSync } from '../lib/tabSync.ts';
import { planReorder } from './tab-manage.ts';

// 시트 한 장을 흉내 내는 상태 기반 목. 구조 batchUpdate(삭제·이동·행 삭제)도 실제로 반영한다.
const state = vi.hoisted(() => ({
  metadata: [] as { id: number; name: string }[], settings: [] as string[][],
  rows: {} as Record<string, string[][]>, failSync: false,
}));
vi.mock('../lib/sheets.ts', () => ({
  getSheetMetadata: async () => state.metadata.map((sheet) => ({ ...sheet })),
  getSheetTitles: async () => state.metadata.map((sheet) => sheet.name),
  getValues: async (_env: Env, _sheet: string, tab: string) => (tab === '_정보' ? state.settings : state.rows[tab] ?? []),
  batchGetValues: async (_env: Env, _sheet: string, ranges: { tab: string; range?: string }[]) => ranges.map(({ tab, range }) => {
    if (tab === '_정보') return state.settings;
    const rows = state.rows[tab] ?? [];
    if (range === 'A2:A') return rows.map((row) => [row[0]]);
    // 탭 전체 읽기는 1행 헤더를 포함한다.
    return range === undefined ? [[], ...rows] : rows;
  }),
  addSheet: async (_env: Env, _sheet: string, name: string) => { state.metadata.push({ id: 99, name }); },
  appendValues: async (_env: Env, _sheet: string, _tab: string, _range: string, values: string[][]) => {
    state.settings.push(...values);
  },
  batchUpdateValues: async (_env: Env, _sheet: string, tab: string, updates: { range: string; values: string[][] }[]) => {
    if (tab !== '_정보') return;
    if (state.failSync) throw new Error('sync failed');
    for (const { range, values } of updates) state.settings[Number(range.slice(1)) - 1][1] = values[0][0];
  },
  batchUpdateSpreadsheet: async (_env: Env, _sheet: string, requests: Record<string, any>[]) => {
    for (const request of requests) {
      if (request.deleteSheet) {
        state.metadata = state.metadata.filter((sheet) => sheet.id !== request.deleteSheet.sheetId);
      } else if (request.updateSheetProperties?.fields === 'title') {
        const { sheetId, title } = request.updateSheetProperties.properties;
        const sheet = state.metadata.find((entry) => entry.id === sheetId)!;
        state.rows[title] = state.rows[sheet.name]; delete state.rows[sheet.name];
        sheet.name = title;
      } else if (request.updateSheetProperties) {
        const { sheetId, index } = request.updateSheetProperties.properties;
        const from = state.metadata.findIndex((sheet) => sheet.id === sheetId);
        const [sheet] = state.metadata.splice(from, 1);
        // Sheets의 index는 "이동 전" 기준 — 오른쪽 이동이면 한 칸 당겨진다.
        state.metadata.splice(index > from ? index - 1 : index, 0, sheet);
      } else if (request.deleteDimension) {
        if (state.failSync) throw new Error('sync failed');
        const { startIndex, endIndex } = request.deleteDimension.range;
        state.settings.splice(startIndex, endIndex - startIndex);
      }
    }
  },
}));

const profiles = [
  { id: 'a', name: 'A', password: 'pw-a', sheetId: 'sheet', modes: ['m1', 'm2'], contentType: 'zh' },
  { id: 'b', name: 'B', password: 'pw-b', sheetId: 'sheet', modes: ['m2'], contentType: 'generic' },
];
const env = makeEnv({ PROFILES: JSON.stringify(profiles) });
const call = (path: string, body?: unknown, profile = 'a') => worker.fetch(makeRequest(path,
  { Authorization: `Bearer pw-${profile}`, 'Content-Type': 'application/json' },
  body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), env);
const manage = (body?: unknown, profile = 'a') => call('/api/tab-manage', body, profile);
async function list(profile = 'a'): Promise<ManagedTab[]> {
  return (await (await manage(undefined, profile)).json() as { tabs: ManagedTab[] }).tabs;
}
const entry = (id: number, disabled = false, modes = ['m1', 'm2']) => ({ id, modes, disabled });

beforeEach(() => {
  state.metadata = [{ id: 10, name: '단어' }, { id: 5, name: '_메모' }, { id: 20, name: '문장' }, { id: 30, name: '회화' }];
  state.settings = []; state.failSync = false;
  state.rows = { 단어: [['词', 'cí', '단어'], ['字', 'zì', '글자']], 문장: [['你好。', '', '안녕']], 회화: [] };
});

describe('GET /api/tab-manage', () => {
  it('lists every study tab in sheet order with defaults and word counts', async () => {
    expect(await list()).toEqual([
      { id: 10, name: '단어', modes: ['m1', 'm2'], explicit: false, disabled: false, wordCount: 2 },
      { id: 20, name: '문장', modes: ['m1', 'm2'], explicit: false, disabled: false, wordCount: 1 },
      { id: 30, name: '회화', modes: ['m1', 'm2'], explicit: false, disabled: false, wordCount: 0 },
    ]);
  });
});

describe('save', () => {
  it('stores modes and disabled state, and hides disabled tabs from words and the register list only', async () => {
    const response = await manage({ action: 'save', tabs: [entry(10, false, ['m2']), entry(20, true)] });
    expect(response.status).toBe(200);
    const tabs = (await response.json() as { tabs: ManagedTab[] }).tabs;
    expect(tabs.map((tab) => [tab.id, tab.modes, tab.disabled])).toEqual([
      [10, ['m2'], false], [20, ['m1', 'm2'], true], [30, ['m1', 'm2'], false],
    ]);

    const words = await (await call('/api/words')).json() as { words: { tab: string; studyModes: string[] }[] };
    expect(words.words.map((word) => word.tab)).toEqual(['단어', '단어']);
    expect(words.words[0].studyModes).toEqual(['m2']);
    expect(await (await call('/api/tabs')).json()).toEqual({ tabs: ['단어', '회화'] });
    // 관리 화면에는 그대로 남고, 설정은 프로필별로 분리된다.
    expect((await list()).map((tab) => tab.name)).toEqual(['단어', '문장', '회화']);
    expect((await list('b')).every((tab) => !tab.disabled)).toBe(true);
    expect(await (await call('/api/tabs', undefined, 'b')).json()).toEqual({ tabs: ['단어', '문장', '회화'] });
  });

  it('re-enables a tab and keeps unsubmitted tabs untouched', async () => {
    await manage({ action: 'save', tabs: [entry(20, true), entry(30, true)] });
    await manage({ action: 'save', tabs: [entry(20, false)] });
    expect((await list()).map((tab) => tab.disabled)).toEqual([false, false, true]);
  });

  it('keeps recording answers for a tab disabled mid-session', async () => {
    await manage({ action: 'save', tabs: [entry(10, true)] });
    const response = await call('/api/answer', { tab: '단어', hanzi: '词', mode: 'm1', timestamp: '2026-11-22 10:00', isReview: false });
    expect(response.status).toBe(200);
  });

  it('reorders study tabs while leaving excluded tabs in place', async () => {
    const response = await manage({ action: 'save', tabs: [], order: [30, 10, 20] });
    expect(response.status).toBe(200);
    expect(state.metadata.map((sheet) => sheet.name)).toEqual(['회화', '_메모', '단어', '문장', '_정보']);
    expect((await list()).map((tab) => tab.id)).toEqual([30, 10, 20]);
  });

  it('rejects invalid payloads with 400 and stale tab sets with 409 without writing', async () => {
    for (const body of [
      { action: 'save', tabs: [{ id: 10, modes: [], disabled: false }] },
      { action: 'save', tabs: [{ id: 10, modes: ['m1'] }] },
      { action: 'save', tabs: [entry(10), entry(10)] },
      { action: 'save', tabs: [], order: [10, 10, 20] },
      { action: 'nope' },
    ]) expect((await manage(body)).status).toBe(400);
    for (const body of [
      { action: 'save', tabs: [entry(999)] },
      { action: 'save', tabs: [entry(5)] },
      { action: 'save', tabs: [], order: [10, 20] },
      { action: 'save', tabs: [], order: [10, 20, 5] },
    ]) expect((await manage(body)).status).toBe(409);
    expect(state.settings).toEqual([]);
    expect(state.metadata.map((sheet) => sheet.id)).toEqual([10, 5, 20, 30]);
  });
});

describe('rename', () => {
  it('renames the tab while keeping its words and ID-based settings', async () => {
    await manage({ action: 'save', tabs: [entry(20, true, ['m2'])] });
    const response = await manage({ action: 'rename', id: 20, name: '  긴 문장 ' });
    expect(response.status).toBe(200);
    expect((await response.json() as { tabs: ManagedTab[] }).tabs[1]).toEqual(
      { id: 20, name: '긴 문장', modes: ['m2'], explicit: true, disabled: true, wordCount: 1 });
  });

  it('rejects bad names with 400 and duplicates or unknown tabs with 409', async () => {
    for (const name of ['', '   ', '_메모', 3]) expect((await manage({ action: 'rename', id: 20, name })).status).toBe(400);
    for (const body of [{ id: 20, name: '단어' }, { id: 999, name: '새 이름' }, { id: 5, name: '새 이름' }]) {
      expect((await manage({ action: 'rename', ...body })).status).toBe(409);
    }
    expect((await manage({ action: 'rename', id: 20, name: '문장' })).status).toBe(200);
    expect(state.metadata.map((sheet) => sheet.name)).toEqual(['단어', '_메모', '문장', '회화']);
  });
});

describe('delete', () => {
  it('deletes the tab and syncs its settings away for every profile', async () => {
    await manage({ action: 'save', tabs: [entry(10, false, ['m1']), entry(20, true, ['m2'])] });
    await manage({ action: 'save', tabs: [entry(20, true, ['m1'])] }, 'b');
    const response = await manage({ action: 'delete', id: 20 });
    expect(response.status).toBe(200);
    const body = await response.json() as { tabs: ManagedTab[]; removed: number };
    expect(body.tabs.map((tab) => tab.id)).toEqual([10, 30]);
    expect(body.removed).toBeGreaterThan(0);
    expect(state.metadata.some((sheet) => sheet.id === 20)).toBe(false);
    expect(state.settings).toEqual([
      ['탭출제유형:a', '{"10":["m1"]}'], ['탭비활성:a', '[]'],
      ['탭출제유형:b', '{}'], ['탭비활성:b', '[]'],
    ]);
  });

  it('refuses excluded, unknown and malformed targets', async () => {
    expect((await manage({ action: 'delete', id: 5 })).status).toBe(409);
    expect((await manage({ action: 'delete', id: 999 })).status).toBe(409);
    expect((await manage({ action: 'delete', id: '10' })).status).toBe(400);
    expect(state.metadata).toHaveLength(4);
  });

  it('refuses to delete the last remaining sheet', async () => {
    state.metadata = [{ id: 10, name: '단어' }];
    expect((await manage({ action: 'delete', id: 10 })).status).toBe(409);
    expect(state.metadata).toHaveLength(1);
  });

  it('still reports success when the follow-up sync fails', async () => {
    await manage({ action: 'save', tabs: [entry(20, true)] });
    state.failSync = true;
    const response = await manage({ action: 'delete', id: 20 });
    expect(response.status).toBe(200);
    expect(state.metadata.some((sheet) => sheet.id === 20)).toBe(false);
  });
});

describe('sync', () => {
  it('drops history rows and dead tab IDs but leaves other settings alone', async () => {
    state.metadata.push({ id: 99, name: '_정보' });
    state.settings = [
      ['문제수', '40'],
      ['탭출제유형:a', '{"10":["m1"],"77":["m2"]}'],
      ['탭비활성:a', '[77]'],
      ['메모', '손으로 쓴 값'],
      ['탭출제유형:a', '{"10":["m2"],"20":["m1"],"88":["m1"]}'],
      ['탭비활성:a', '[20,88]'],
    ];
    const response = await manage({ action: 'sync' });
    expect(await response.json()).toMatchObject({ removed: 4 });
    expect(state.settings).toEqual([
      ['문제수', '40'], ['메모', '손으로 쓴 값'],
      ['탭출제유형:a', '{"10":["m2"],"20":["m1"]}'], ['탭비활성:a', '[20]'],
    ]);
    expect((await list()).map((tab) => [tab.modes, tab.disabled])).toEqual([
      [['m2'], false], [['m1'], true], [['m1', 'm2'], false],
    ]);
    expect(await (await manage({ action: 'sync' })).json()).toMatchObject({ removed: 0 });
  });

  it('is a no-op without a settings tab', async () => {
    expect(await (await manage({ action: 'sync' })).json()).toMatchObject({ removed: 0 });
  });
});

describe('planning helpers', () => {
  it('planTabSync leaves unparseable values untouched', () => {
    const plan = planTabSync([['탭출제유형:a', 'not json'], ['탭비활성:a', '{"x":1}']], new Set([1]));
    expect(plan).toEqual({ updates: [], staleRows: [], prunedEntries: 0 });
  });
  it('planReorder emits no moves for the current order', () => {
    const sheets = [{ id: 1, name: 'a' }, { id: 2, name: '_x' }, { id: 3, name: 'b' }];
    expect(planReorder(sheets, [1, 3])).toEqual([]);
    expect(planReorder(sheets, [3, 1]).map((move) => move.updateSheetProperties.properties)).toEqual([
      { sheetId: 3, index: 0 }, { sheetId: 2, index: 1 },
    ]);
  });
});
