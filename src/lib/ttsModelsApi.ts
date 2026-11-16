import { TTS_MODELS, isTtsModel, type TtsModel } from '../../shared/ttsModels.ts';
import { apiFetch } from './api.ts';
export async function ttsModelsRequest(model?: TtsModel, signal?: AbortSignal): Promise<TtsModel> {
  const response = await apiFetch('/api/tts-models', model === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal,
  });
  // 401·405처럼 본문이 없거나 JSON이 아닌 실패 응답을 파싱하지 않도록 상태부터 확인한다.
  if (!response.ok) throw new Error(`음성 모델 설정 요청에 실패했습니다 (HTTP ${response.status})`);
  const body = await response.json();
  if (!isTtsModel(body?.model) || !Array.isArray(body.models) || body.models.length !== TTS_MODELS.length
    || !TTS_MODELS.every((item) => body.models.includes(item))) throw new Error('음성 모델 설정 응답이 올바르지 않습니다.');
  return body.model;
}
