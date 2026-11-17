export const TTS_MODELS = [
  'qwen-audio-3.0-tts-flash',
  'qwen-audio-3.0-tts-plus',
  'qwen-audio-3.1-tts-flash',
  'qwen-audio-3.1-tts-plus',
] as const;
export type TtsModel = typeof TTS_MODELS[number];
export function isTtsModel(value: unknown): value is TtsModel {
  return typeof value === 'string' && TTS_MODELS.some((model) => model === value);
}

/**
 * Qwen-Audio-TTS는 음색 ID가 모델 세대별로 다르고 섞어 쓸 수 없다 — 3.0 계열은
 * `longanfengyue`, 3.1 계열은 `longanfengyue_v3.1`. 모델만 바꾸고 음색을 그대로 보내면
 * 제공자가 요청을 거부한다(502 tts_upstream_error).
 */
export const TTS_VOICE_BY_MODEL = {
  'qwen-audio-3.0-tts-flash': 'longanfengyue',
  'qwen-audio-3.0-tts-plus': 'longanfengyue',
  'qwen-audio-3.1-tts-flash': 'longanfengyue_v3.1',
  'qwen-audio-3.1-tts-plus': 'longanfengyue_v3.1',
} as const satisfies Record<TtsModel, string>;
export type TtsVoice = typeof TTS_VOICE_BY_MODEL[TtsModel];
export function ttsVoiceForModel(model: TtsModel): TtsVoice {
  return TTS_VOICE_BY_MODEL[model];
}
