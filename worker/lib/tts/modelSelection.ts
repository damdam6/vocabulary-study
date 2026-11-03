import { isTtsModel, type TtsModel } from '../../../shared/ttsModels.ts';
import { resolveTtsConfig } from './config.ts';
import { TTS_MODEL, type TtsEnv } from './types.ts';

export const MODEL_SELECTION_KEY = 'settings/tts-model.json';
interface SelectionBucket {
  get(key: string): Promise<{ json(): Promise<unknown> } | null>;
  put(key: string, body: string, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}
export function selectionBucket(env: TtsEnv): SelectionBucket {
  if (!env.TTS_AUDIO) throw new Error('TTS storage unavailable');
  return env.TTS_AUDIO as unknown as SelectionBucket;
}
export async function readModelSelection(env: TtsEnv): Promise<TtsModel> {
  const object = await selectionBucket(env).get(MODEL_SELECTION_KEY);
  if (object == null) {
    const fallback = env.TTS_MODEL ?? TTS_MODEL;
    if (!isTtsModel(fallback)) throw new Error('Invalid default TTS model');
    return fallback;
  }
  const body = await object.json() as { model?: unknown } | null;
  if (!isTtsModel(body?.model)) throw new Error('Invalid saved TTS model');
  return body.model;
}
export async function resolveSelectedTtsConfig(env: TtsEnv) {
  const initial = resolveTtsConfig(env);
  if (initial.status !== 'ready') return initial;
  const model = await readModelSelection(env);
  const resolved = resolveTtsConfig({ ...env, TTS_MODEL: model });
  if (resolved.status === 'ready' && model !== TTS_MODEL) {
    // Keep existing default-model audio reusable, while separating browser caches.
    resolved.config.revision += '-' + model.replaceAll('.', '-');
  }
  return resolved;
}
