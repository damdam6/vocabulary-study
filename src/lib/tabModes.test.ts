// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSessionQueue } from './sessionQueue.ts';
import { computeHomeStats } from './homeStats.ts';
import { getWordState } from './wordState.ts';
import { saveProfile } from './api.ts';
import { enqueueAnswer, enqueueReviewFail, flushRetryQueue, RETRY_QUEUE_STORAGE_KEY } from './retryQueue.ts';
import { fetchWords } from './wordsApi.ts';
import { tabModesRequest } from './tabModesApi.ts';
import type { StudyMode } from '../../shared/studyModes.ts';
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('tab-specific session rules', () => {
  it('classifies and quizzes every word using its tab modes, including sentence and word rows', () => {
    const words = [
      { tab: '뜻', hanzi: '단어', m1: 3, m2: 0, nextReview: null, studyModes: ['m1'] as StudyMode[] },
      { tab: '뜻', hanzi: '긴 문장', m1: 0, m2: 0, nextReview: null, studyModes: ['m1'] as StudyMode[] },
      { tab: '쓰기', hanzi: '문장', m1: 0, m2: 2, nextReview: null, studyModes: ['m2'] as StudyMode[] },
      { tab: '기본', hanzi: 'old', m1: 3, m2: 1, nextReview: null },
    ];
    const queue = buildSessionQueue(words, '2026-09-29', ['m1', 'm2']);
    expect(queue).toHaveLength(computeHomeStats(words, '2026-09-29', ['m1', 'm2']).sessionCount);
    expect(queue.filter((entry) => entry.word.tab === '뜻').every((entry) => entry.mode === 'm1')).toBe(true);
    expect(queue.find((entry) => entry.word.tab === '쓰기')?.mode).toBe('m2');
    expect(queue.find((entry) => entry.word.tab === '기본')?.mode).toBe('m2');
    for (const tab of ['뜻', '쓰기', '기본']) {
      const selected = words.filter((word) => word.tab === tab);
      expect(buildSessionQueue(selected, '2026-09-29', ['m1', 'm2']).length).toBe(computeHomeStats(selected, '2026-09-29', ['m1', 'm2']).sessionCount);
    }
    const expanded = { ...words[0], studyModes: ['m1', 'm2'] as StudyMode[] };
    expect(getWordState(expanded, '2026-09-29', ['m1'])).toBe('learning');
    expect(expanded.m1).toBe(3);
  });
  it('keeps the original modes in answer and review-fail payloads through retry', async () => {
    saveProfile({ id: 'a', name: 'A', modes: ['m1', 'm2'], contentType: 'zh' });
    enqueueAnswer({ tab: '문장', hanzi: '你好。', mode: 'm1', timestamp: 't', isReview: true, studyModes: ['m1'] });
    enqueueReviewFail({ tab: '문장', hanzi: '你好。', studyModes: ['m1'] });
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({})); vi.stubGlobal('fetch', fetchMock);
    await flushRetryQueue();
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).studyModes)).toEqual([['m1'], ['m1']]);
    expect(JSON.parse(localStorage.getItem(RETRY_QUEUE_STORAGE_KEY)!)).toEqual([]);
  });
  it('rejects malformed nonempty server mode contracts instead of silently changing the queue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ words: [{ studyModes: [] }] })));
    await expect(fetchWords()).rejects.toThrow('올바르지');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ tabs: [{ id: 1, name: 'tab', modes: ['m3'], explicit: true }] }));
    await expect(tabModesRequest()).rejects.toThrow('올바르지');
  });
});
