import {
  DEFAULT_TTS_RATE,
  DEFAULT_TTS_REVISION,
  TTS_ADAPTER_VERSION,
  TTS_AUDIO_SETTINGS,
  TTS_ENDPOINT,
  TTS_MODEL,
  TTS_OUTPUT_FORMAT,
  TTS_PRONUNCIATION_POLICY,
  TTS_PROVIDER,
  TTS_REGION,
  TTS_UPGRADE_ENDPOINT,
  TTS_VOICE,
  type ResolvedTtsConfig,
  type TtsAudioBinding,
  type TtsConfig,
  type TtsEnv,
} from "./types.ts";

const RATE_PATTERN = /^(?:0(?:\.\d+)?|1(?:\.\d+)?|2(?:\.0+)?)$/;
const REVISION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 설정은 TTS 경로에서만 사용한다. disabled/not_configured는 예외가 아니라
 * capability·라우트가 판별할 수 있는 결과이며 PROFILES 파서에는 접근하지 않는다.
 */
export function resolveTtsConfig(env: TtsEnv): ResolvedTtsConfig {
  if (env.TTS_ENABLED === undefined || env.TTS_ENABLED === "false") {
    return { status: "disabled", code: "tts_disabled" };
  }
  if (env.TTS_ENABLED !== "true") {
    return { status: "not_configured", code: "tts_not_configured" };
  }

  const provider = env.TTS_PROVIDER ?? TTS_PROVIDER;
  const model = env.TTS_MODEL ?? TTS_MODEL;
  const voice = env.TTS_VOICE ?? TTS_VOICE;
  const revision = env.TTS_REVISION ?? DEFAULT_TTS_REVISION;
  const rate = parseRate(env.TTS_RATE);
  if (
    provider !== TTS_PROVIDER ||
    model !== TTS_MODEL ||
    voice !== TTS_VOICE ||
    !REVISION_PATTERN.test(revision) ||
    rate === null ||
    !isNonEmptyString(env.DASHSCOPE_API_KEY) ||
    !isTtsAudioBinding(env.TTS_AUDIO)
  ) {
    return { status: "not_configured", code: "tts_not_configured" };
  }

  const config: TtsConfig = {
    provider: TTS_PROVIDER,
    model: TTS_MODEL,
    voice: TTS_VOICE,
    rate,
    revision,
    region: TTS_REGION,
    outputFormat: TTS_OUTPUT_FORMAT,
    adapterVersion: TTS_ADAPTER_VERSION,
    pronunciationPolicy: TTS_PRONUNCIATION_POLICY,
    endpoint: TTS_ENDPOINT,
    upgradeEndpoint: TTS_UPGRADE_ENDPOINT,
    audioSettings: TTS_AUDIO_SETTINGS,
  };
  return { status: "ready", config, dependencies: { apiKey: env.DASHSCOPE_API_KEY, audio: env.TTS_AUDIO } };
}

function parseRate(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_TTS_RATE;
  if (!RATE_PATTERN.test(value)) return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0.5 && rate <= 2 ? rate : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTtsAudioBinding(value: unknown): value is TtsAudioBinding {
  return typeof value === "object" && value !== null && typeof (value as TtsAudioBinding).get === "function" && typeof (value as TtsAudioBinding).put === "function";
}
