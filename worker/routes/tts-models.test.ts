import { describe, it, expect, vi } from 'vitest';
import worker from '../index.ts';
import { makeEnv, makeRequest } from '../test-utils.ts';
import { TTS_MODELS } from '../../shared/ttsModels.ts';
import { MODEL_SELECTION_KEY, resolveSelectedTtsConfig } from '../lib/tts/modelSelection.ts';
import { buildAudioObjectKey } from '../lib/tts/storage.ts';
import { createQwenClientMessages } from '../lib/tts/providers/qwenProtocol.ts';
const profiles = [
  { id: 'zh', name: 'Chinese', password: 'test-zh', sheetId: 'sheet', modes: ['m1'], contentType: 'zh' },
  { id: 'other', name: 'Other', password: 'test-other', sheetId: 'other', modes: ['m1'], contentType: 'generic' },
];
function setup() {
  const objects = new Map<string, string>();
  const bucket = {
    get: vi.fn(async (key: string) => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)!) } : null),
    put: vi.fn(async (key: string, body: string) => { objects.set(key, body); return { etag: 'ok' }; }),
  };
  const env = makeEnv({ PROFILES: JSON.stringify(profiles), TTS_AUDIO: bucket, TTS_ENABLED: 'true', DASHSCOPE_API_KEY: 'test-only' });
  const call = (model?: unknown, token = 'test-zh') => worker.fetch(makeRequest('/api/tts-models', { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, model === undefined ? {} : { method: 'POST', body: JSON.stringify({ model }) }), env);
  return { objects, bucket, env, call };
}
describe('persisted Qwen model selection', () => {
  it('defaults to the existing model and lists exactly four models', async () => {
    const { call } = setup();
    const res = await call();
    expect(await res.json()).toEqual({ models: TTS_MODELS, model: TTS_MODELS[0] });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it.each(TTS_MODELS)('persists %s and sends it to Qwen', async (model) => {
    const { call, env, objects } = setup();
    expect((await call(model)).status).toBe(200);
    expect(await (await call()).json()).toMatchObject({ model });
    expect(JSON.parse(objects.get(MODEL_SELECTION_KEY)!)).toEqual({ model });
    const resolved = await resolveSelectedTtsConfig(env);
    expect(resolved.status).toBe('ready');
    if (resolved.status !== 'ready') throw new Error('not ready');
    expect(resolved.config.model).toBe(model);
    expect(JSON.parse(createQwenClientMessages('00000000-0000-4000-8000-000000000001', resolved.config, { text: '你好' }).runTask).payload.model).toBe(model);
  });
  it('rejects unauthenticated, non-Chinese and unregistered choices without writing', async () => {
    const { call, bucket } = setup();
    expect((await call(TTS_MODELS[1], 'wrong')).status).toBe(401);
    expect((await call(TTS_MODELS[1], 'test-other')).status).toBe(403);
    for (const value of ['cosyvoice-v3-flash', 'qwen-audio-3.1-asr-flash', [], null, 4]) expect((await call(value)).status).toBe(400);
    expect(bucket.put).not.toHaveBeenCalled();
  });
  it('separates model caches and reuses the original cache on switching back', async () => {
    const { env, call } = setup();
    const keys = new Set<string>(); const revisions = new Set<string>();
    for (const model of TTS_MODELS) {
      await call(model);
      const result = await resolveSelectedTtsConfig(env);
      if (result.status !== 'ready') throw new Error('not ready');
      keys.add(await buildAudioObjectKey(profiles[0]!, { text: '你好', pinyin: null }, result.config));
      revisions.add(result.config.revision);
    }
    expect(keys.size).toBe(4); expect(revisions.size).toBe(4);
    await call(TTS_MODELS[0]);
    const result = await resolveSelectedTtsConfig(env);
    if (result.status !== 'ready') throw new Error('not ready');
    expect(result.config.revision).toBe('tts-v1');
    expect(await buildAudioObjectKey(profiles[0]!, { text: '你好', pinyin: null }, result.config)).toBe([...keys][0]);
  });
  it('does not silently use the old model when storage fails', async () => {
    const { bucket, call, env } = setup();
    bucket.put.mockRejectedValue(new Error('storage unavailable'));
    expect((await call(TTS_MODELS[2])).status).toBe(503);
    bucket.get.mockRejectedValue(new Error('storage unavailable'));
    expect((await call()).status).toBe(503);
    await expect(resolveSelectedTtsConfig(env)).rejects.toThrow();
  });
});
