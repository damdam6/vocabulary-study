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
 * Qwen-Audio-TTS는 모델마다 쓸 수 있는 음색 ID가 다르고 섞어 쓸 수 없다. 모델만 바꾸고
 * 음색을 그대로 보내면 제공자가 요청을 거부한다(502 tts_upstream_error).
 *
 * 공식 음색 목록 기준(2026-11 확인):
 * - 3.0-flash: `longanfengyue` 제공.
 * - 3.0-plus: 시스템 음색이 `longanlingxin`(여)·`longanlufeng`(남) 둘뿐이라 `longanfengyue`가 없다
 *   — 같은 여성 표준 중국어 음색인 `longanlingxin`을 쓴다.
 * - 3.1 계열: 버전이 붙은 `longanfengyue_v3.1`.
 */
export const TTS_VOICE_BY_MODEL = {
  'qwen-audio-3.0-tts-flash': 'longanfengyue',
  'qwen-audio-3.0-tts-plus': 'longanlingxin',
  'qwen-audio-3.1-tts-flash': 'longanfengyue_v3.1',
  'qwen-audio-3.1-tts-plus': 'longanfengyue_v3.1',
} as const satisfies Record<TtsModel, string>;
export type TtsVoice = typeof TTS_VOICE_BY_MODEL[TtsModel];
export function ttsVoiceForModel(model: TtsModel): TtsVoice {
  return TTS_VOICE_BY_MODEL[model];
}
