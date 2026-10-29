import { TTS_MODELS, isTtsModel, type TtsModel } from '../../shared/ttsModels.ts';
import { apiFetch } from './api.ts';
export async function ttsModelsRequest(model?: TtsModel, signal?: AbortSignal): Promise<TtsModel> {
  const response = await apiFetch('/api/tts-models', model === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? '음성 모델 설정 요청에 실패했습니다.');
  if (!isTtsModel(body?.model) || !Array.isArray(body.models) || body.models.length !== TTS_MODELS.length
    || !TTS_MODELS.every((item) => body.models.includes(item))) throw new Error('음성 모델 설정 응답이 올바르지 않습니다.');
  return body.model;
}
