import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEnv, makeRequest } from '../test-utils.ts';
import worker from '../index.ts';
import { buildSessionQueue } from '../../src/lib/sessionQueue.ts';
import { computeHomeStats } from '../../src/lib/homeStats.ts';
import type { TabModeSetting } from '../../shared/studyModes.ts';
import type { WordEntry } from '../lib/words.ts';

const state = vi.hoisted(() => ({
  metadata: [] as { id: number; name: string }[], settings: [] as string[][],
  rows: {} as Record<string, string[][]>, writes: [] as { tab: string; range: string; values: (string | number)[][] }[],
  failRead: false, failWrite: false, sheetIds: [] as string[],
}));
vi.mock('../lib/sheets.ts', () => ({
  getSheetMetadata: async (_env: Env, sheetId: string) => { state.sheetIds.push(sheetId); return state.metadata; },
  getValues: async (_env: Env, _sheet: string, tab: string, range: string) => {
    if (tab === '_정보') { if (state.failRead) throw new Error('read failed'); return state.settings; }
    const rows = state.rows[tab] ?? [];
    if (range === 'A2:A') return rows.map((row) => [row[0]]);
    const match = range.match(/^(\d+):(\d+)$/);
    return match ? [rows[Number(match[1]) - 2]] : rows;
  },
  addSheet: async (_env: Env, _sheet: string, name: string) => { state.metadata.push({ id: 99, name }); },
  appendValues: async (_env: Env, _sheet: string, tab: string, range: string, values: string[][]) => {
    if (state.failWrite) throw new Error('write failed');
    state.writes.push({ tab, range, values }); state.settings.push(...values);
  },
  updateValues: async (_env: Env, _sheet: string, tab: string, range: string, values: string[][]) => {
    state.writes.push({ tab, range, values });
  },
  batchUpdateValues: async (_env: Env, _sheet: string, tab: string, updates: { range: string; values: (string | number)[][] }[]) => {
    state.writes.push(...updates.map((update) => ({ tab, ...update })));
  },
}));
const profiles = [
  { id: 'a', name: 'A', password: 'pw-a', sheetId: 'shared-sheet', modes: ['m1', 'm2'], contentType: 'zh' },
  { id: 'b', name: 'B', password: 'pw-b', sheetId: 'shared-sheet', modes: ['m2'], contentType: 'generic' },
];
const env = makeEnv({ PROFILES: JSON.stringify(profiles) });
const call = (path: string, body?: unknown, profile = 'a') => worker.fetch(makeRequest(path,
  { Authorization: `Bearer pw-${profile}`, 'Content-Type': 'application/json' },
  body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), env);
async function readTabs(profile = 'a'): Promise<{ tabs: TabModeSetting[] }> {
  return await (await call('/api/tab-modes', undefined, profile)).json() as { tabs: TabModeSetting[] };
}
const save = (modes: string[], id = 10) => call('/api/tab-modes', { tabs: [{ id, modes }] });

beforeEach(() => {
  state.metadata = [{ id: 10, name: '단어' }, { id: 20, name: '문장' }];
  state.settings = []; state.writes = []; state.sheetIds = []; state.failRead = false; state.failWrite = false;
  state.rows = { 단어: [['词', 'cí', '단어', '3', '1', '']], 문장: [['我有2本书。', '', '문장', '0', '0', '']] };
});

describe('profile/tab study modes', () => {
  it('defaults existing/new/empty tabs and isolates two profiles sharing one spreadsheet', async () => {
    expect((await readTabs()).tabs[0]).toEqual({ id: 10, name: '단어', modes: ['m1', 'm2'], explicit: false });
    expect((await save(['m1'])).status).toBe(200);
    expect((await readTabs()).tabs[0].modes).toEqual(['m1']);
    expect((await readTabs('b')).tabs[0].modes).toEqual(['m2']);
    expect(state.sheetIds.every((id) => id === 'shared-sheet')).toBe(true);
    expect(state.writes.every((write) => write.tab === '_정보')).toBe(true);
    state.metadata.push({ id: 30, name: '빈 신규 탭' });
    expect((await readTabs()).tabs[2]).toMatchObject({ id: 30, modes: ['m1', 'm2'], explicit: false });
  });

  it('preserves renamed tab settings and gives recreated tabs defaults; next snapshot prunes deleted IDs', async () => {
    await save(['m2']);
    state.metadata[0].name = '이름 변경';
    expect((await readTabs()).tabs[0].modes).toEqual(['m2']);
    state.metadata[0].id = 11;
    expect((await readTabs()).tabs[0].modes).toEqual(['m1', 'm2']);
    await save(['m1'], 11);
    expect(JSON.parse(state.settings.at(-1)![1])).toEqual({ 11: ['m1'] });
  });

  it.each([[], ['m3'], ['m1', 'm1'], ['m1', 'm2', 'm1'], null])('rejects invalid or empty modes %j', async (modes) => {
    const response = await call('/api/tab-modes', { tabs: [{ id: 10, modes }] });
    expect(response.status).toBe(400); expect(state.writes).toEqual([]);
  });
  it('rejects unknown IDs, excluded settings tabs, duplicate IDs and unauthenticated writes', async () => {
    expect((await save(['m1'], 999)).status).toBe(409);
    await save(['m1']);
    expect((await save(['m1'], 99)).status).toBe(409);
    expect((await call('/api/tab-modes', { tabs: [{ id: 10, modes: ['m1'] }, { id: 10, modes: ['m2'] }] })).status).toBe(400);
    expect((await worker.fetch(makeRequest('/api/tab-modes', {}, { method: 'POST', body: '{}' }), env)).status).toBe(401);
  });
  it('reports read/write/corrupt configuration failures, never silently using default modes', async () => {
    await save(['m1']);
    state.failRead = true;
    expect((await call('/api/words')).status).toBe(500);
    expect((await call('/api/tab-modes')).status).toBe(500);
    state.failRead = false; state.failWrite = true;
    expect((await save(['m2'])).status).toBe(500);
    state.settings.push(['탭출제유형:a', '{bad']);
    expect((await call('/api/words')).status).toBe(500);
  });
  it('uses the same effective modes for mixed-tab queues, home totals and server graduation', async () => {
    await save(['m1']); await save(['m2'], 20);
    const data = await (await call('/api/words')).json() as { words: WordEntry[] };
    const stats = computeHomeStats(data.words, '2026-09-29', ['m1', 'm2']);
    const queue = buildSessionQueue(data.words, '2026-09-29', ['m1', 'm2']);
    expect(stats).toMatchObject({ reviewDue: 1, learning: 1, graduated: 1, sessionCount: queue.length });
    expect(queue.find((q) => q.word.tab === '단어')).toMatchObject({ mode: 'm1', isReview: true });
    expect(queue.find((q) => q.word.tab === '문장')).toMatchObject({ mode: 'm2', isReview: false });
    state.rows.문장[0][4] = '2';
    const response = await call('/api/answer', { tab: '문장', hanzi: '我有2本书。', mode: 'm2', isReview: false, timestamp: '2026-09-29 10:00', studyModes: ['m2'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ m1: 0, m2: 3, interval: 1 });
  });
  it('preserves progress and schedule when expanding and regraduating; disabled progress resumes', async () => {
    state.rows.단어[0] = ['词', 'cí', '단어', '3', '2', '2026-10-10|7'];
    await save(['m1']);
    await save(['m1', 'm2']);
    const data = await (await call('/api/words')).json() as { words: WordEntry[] };
    expect(buildSessionQueue(data.words.filter((word) => word.tab === '단어'), '2026-09-29', ['m1', 'm2'])[0]).toMatchObject({ mode: 'm2', isReview: false });
    const response = await call('/api/answer', { tab: '단어', hanzi: '词', mode: 'm2', isReview: false, timestamp: '2026-09-29 10:00', studyModes: ['m1', 'm2'] });
    expect(await response.json()).toMatchObject({ m1: 3, m2: 3, nextReview: '2026-10-10', interval: 7 });
    expect(state.writes.filter((write) => write.tab === '단어').map((write) => write.range)).toEqual(['E2', 'G2']);
  });
  it('honors the original session snapshot for delayed answers and review failures after a settings change', async () => {
    await save(['m1']);
    // Original m1-only session saw this as graduated; new settings require m2 as well.
    await save(['m1', 'm2']);
    const response = await call('/api/answer', { tab: '단어', hanzi: '词', mode: 'm1', isReview: true, timestamp: '2026-09-29 10:00', studyModes: ['m1'] });
    expect(await response.json()).toMatchObject({ m1: 4, m2: 1, interval: 1 });
    expect((await call('/api/review-fail', { tab: '단어', hanzi: '词', studyModes: ['m1'] })).status).toBe(200);
    const count = state.writes.length;
    expect((await call('/api/review-fail', { tab: '단어', hanzi: '词' })).status).toBe(200);
    expect(state.writes).toHaveLength(count); // Legacy retry uses current modes; still learning.
    expect((await call('/api/answer', { tab: '단어', hanzi: '词', mode: 'm2', timestamp: 't', isReview: false, studyModes: ['m1'] })).status).toBe(400);
  });
  it('allows explicit m2-only settings even when the profile default is m1-only/m2-only', async () => {
    const response = await call('/api/tab-modes', { tabs: [{ id: 20, modes: ['m1'] }] }, 'b');
    expect(response.status).toBe(200);
    expect((await (await call('/api/words', undefined, 'b')).json() as { words: WordEntry[] }).words[1].studyModes).toEqual(['m1']);
  });
});
