import { isTtsModel, ttsVoiceForModel, type TtsModel } from '../../../shared/ttsModels.ts';
import { resolveTtsConfig, TTS_REVISION_PATTERN } from './config.ts';
import { TTS_MODEL, TTS_STORAGE_TIMEOUT_MS, type ResolvedTtsConfig, type TtsEnv } from './types.ts';

export const MODEL_SELECTION_KEY = 'settings/tts-model.json';
interface SelectionBucket {
  get(key: string): Promise<{ json(): Promise<unknown> } | null>;
  put(key: string, body: string, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}
export function selectionBucket(env: TtsEnv): SelectionBucket {
  if (!env.TTS_AUDIO) throw new Error('TTS storage unavailable');
  return env.TTS_AUDIO as unknown as SelectionBucket;
}
/**
 * 설정 읽기도 오디오 저장소 호출과 같은 상한을 지킨다 — R2 지연이 요청 전체를
 * 붙잡지 않게 하고, 요청 취소도 즉시 반영한다.
 */
async function getSelectionObject(env: TtsEnv, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
  // 테스트 더블처럼 동기 값을 돌려주는 binding도 같은 경로로 다룬다.
  const pending = Promise.resolve(selectionBucket(env).get(MODEL_SELECTION_KEY));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TTS model selection read timed out')), TTS_STORAGE_TIMEOUT_MS);
        onAbort = () => reject(signal!.reason);
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    void pending.catch(() => undefined);
  }
}
export async function readModelSelection(env: TtsEnv, signal?: AbortSignal): Promise<TtsModel> {
  const object = await getSelectionObject(env, signal);
  if (object == null) {
    const fallback = env.TTS_MODEL ?? TTS_MODEL;
    if (!isTtsModel(fallback)) throw new Error('Invalid default TTS model');
    return fallback;
  }
  const body = await object.json() as { model?: unknown } | null;
  if (!isTtsModel(body?.model)) throw new Error('Invalid saved TTS model');
  return body.model;
}
/**
 * 이미 검증된 설정에서 모델과 revision만 교체한다. 호출부가 앞서 구한 결과를 넘기면
 * 설정 검증을 반복하지 않는다.
 */
export async function resolveSelectedTtsConfig(
  env: TtsEnv,
  initial: ResolvedTtsConfig = resolveTtsConfig(env),
  signal?: AbortSignal,
): Promise<ResolvedTtsConfig> {
  if (initial.status !== 'ready') return initial;
  const model = await readModelSelection(env, signal);
  // Keep existing default-model audio reusable, while separating browser caches.
  const revision = model === TTS_MODEL ? initial.config.revision : initial.config.revision + '-' + model.replaceAll('.', '-');
  // 접미사를 붙인 revision도 클라이언트와 공유하는 형식 계약을 지켜야 한다.
  if (!TTS_REVISION_PATTERN.test(revision)) return { status: 'not_configured', code: 'tts_not_configured' };
  // 음색 ID는 모델 세대별로 달라 모델과 함께 바꿔야 한다.
  return { ...initial, config: { ...initial.config, model, voice: ttsVoiceForModel(model), revision } };
}
