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
