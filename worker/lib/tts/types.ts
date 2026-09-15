/**
 * 중국어 TTS의 Worker 공통 계약. 이 파일은 라우트·저장소·제공자 구현보다 먼저
 * 고정되는 경계이며, 비밀값은 공개 설정과 분리한다.
 */

export const MAX_TTS_REQUEST_BYTES = 16 * 1024;
export const MAX_TTS_TEXT_LENGTH = 200;
export const MAX_TTS_PINYIN_LENGTH = 1_000;
export const MAX_TTS_AUDIO_BYTES = 4 * 1024 * 1024;
export const MAX_TTS_PROVIDER_JSON_BYTES = 64 * 1024;
export const MAX_TTS_PROVIDER_TOTAL_BYTES = 1024 * 1024;
export const TTS_STORAGE_TIMEOUT_MS = 2_000;
export const TTS_SYNTHESIS_TIMEOUT_MS = 12_000;
export const TTS_CLIENT_PREPARE_TIMEOUT_MS = 20_000;
export const TTS_BLOB_CACHE_MAX_ENTRIES = 20;
export const TTS_BLOB_CACHE_MAX_BYTES = 8 * 1024 * 1024;

export const TTS_PROVIDER = "qwen" as const;
export const TTS_MODEL = "qwen-audio-3.0-tts-flash" as const;
export const TTS_VOICE = "longanfengyue" as const;
export const TTS_REGION = "intl" as const;
export const TTS_OUTPUT_FORMAT = "mp3" as const;
export const TTS_ADAPTER_VERSION = "qwen-ws-v1" as const;
export const TTS_PRONUNCIATION_POLICY = "pinyin-none-v1" as const;
export const TTS_ENDPOINT = "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference" as const;
export const TTS_UPGRADE_ENDPOINT = "https://dashscope-intl.aliyuncs.com/api-ws/v1/inference" as const;
export const DEFAULT_TTS_RATE = 1 as const;
export const DEFAULT_TTS_REVISION = "tts-v1" as const;

/** sampleRate, bitRate, volume, pitch, seed, languageHints, enableSsml, instruction */
export type TtsAudioSettings = readonly [
  sampleRate: 24000,
  bitRate: 128,
  volume: 50,
  pitch: 1,
  seed: 0,
  languageHints: readonly ["zh"],
  enableSsml: false,
  instruction: null,
];

export const TTS_AUDIO_SETTINGS: TtsAudioSettings = Object.freeze([
  24000, 128, 50, 1, 0, Object.freeze(["zh"]), false, null,
]) as unknown as TtsAudioSettings;

export type TtsErrorCode =
  | "invalid_tts_request"
  | "tts_not_allowed"
  | "method_not_allowed"
  | "tts_request_too_large"
  | "unsupported_media_type"
  | "tts_disabled"
  | "tts_not_configured"
  | "tts_unavailable"
  | "tts_storage_unavailable"
  | "tts_upstream_error"
  | "tts_timeout";

export interface TtsPublicError {
  error: TtsErrorCode;
  message: string;
}

/** 라우트가 그대로 사용할 안정적인 공개 오류와 상태 코드. */
export const TTS_ERROR_RESPONSES: Readonly<Record<TtsErrorCode, Readonly<TtsPublicError & { status: number }>>> = {
  invalid_tts_request: { status: 400, error: "invalid_tts_request", message: "발음 요청이 올바르지 않습니다." },
  tts_not_allowed: { status: 403, error: "tts_not_allowed", message: "이 프로필에서는 발음 기능을 사용할 수 없습니다." },
  method_not_allowed: { status: 405, error: "method_not_allowed", message: "허용되지 않는 요청 방식입니다." },
  tts_request_too_large: { status: 413, error: "tts_request_too_large", message: "발음 요청이 너무 큽니다." },
  unsupported_media_type: { status: 415, error: "unsupported_media_type", message: "JSON 요청만 지원합니다." },
  tts_disabled: { status: 503, error: "tts_disabled", message: "발음 기능이 현재 비활성화되어 있습니다." },
  tts_not_configured: { status: 503, error: "tts_not_configured", message: "발음 기능 설정이 완료되지 않았습니다." },
  tts_unavailable: { status: 503, error: "tts_unavailable", message: "발음을 불러올 수 없습니다." },
  tts_storage_unavailable: { status: 503, error: "tts_storage_unavailable", message: "발음 저장소를 사용할 수 없습니다." },
  tts_upstream_error: { status: 502, error: "tts_upstream_error", message: "발음 생성 결과가 올바르지 않습니다." },
  tts_timeout: { status: 504, error: "tts_timeout", message: "발음 생성 시간이 초과되었습니다." },
};

export const TTS_RESPONSE_HEADERS = {
  cacheControl: "private, no-store",
  contentType: "audio/mpeg",
  contentTypeOptions: "nosniff",
  source: "X-TTS-Source",
  storage: "X-TTS-Storage",
  pronunciation: "X-TTS-Pronunciation",
  revision: "X-TTS-Revision",
} as const;

export interface TtsRequest {
  text: string;
  pinyin?: string;
}

/** 입력 정규화가 끝난 뒤의 값. pinyin은 저장 키 소비자에게만 보존된다. */
export interface NormalizedTtsInput {
  text: string;
  pinyin: string | null;
}

/** 제공자로 넘어가는 첫 버전의 payload — 병음·SSML·instruction을 절대 포함하지 않는다. */
export interface SynthesisInput {
  text: string;
}

export type PronunciationDecision =
  | { status: "absent"; reason: null; effectiveHint: null }
  | { status: "ignored"; reason: "provider_hint_unsupported"; effectiveHint: null };

export type TtsSource = "STORED" | "GENERATED";
export type TtsStorage = "PRESENT" | "SAVED" | "UNCONFIRMED";

export type TtsResponseDiagnostics =
  | { source: "STORED"; storage: "PRESENT"; pronunciation: PronunciationDecision["status"]; revision: string }
  | { source: "GENERATED"; storage: "SAVED" | "UNCONFIRMED"; pronunciation: PronunciationDecision["status"]; revision: string };

/** MP3 검사는 후속 이슈가 주입한다. 이 공통 계약은 검사 구현을 갖지 않는다. */
export type ValidateAudio = (audio: Uint8Array, contentType: string) => boolean;

export interface TtsProvider {
  pronunciationMode: "none";
  synthesize(input: SynthesisInput, signal: AbortSignal): Promise<{
    audio: Uint8Array;
    contentType: "audio/mpeg";
    billedCharacters?: number;
  }>;
}

/** R2 생성 타입을 수정하지 않고 테스트 더블도 받을 수 있는 최소 binding 경계. */
export interface TtsAudioBinding {
  get: (...args: never[]) => unknown;
  put: (...args: never[]) => unknown;
}

/** 기존 Env와 `Env & TtsEnv`로 합성할 선택적 TTS 설정. */
export interface TtsEnv {
  TTS_ENABLED?: string;
  TTS_PROVIDER?: string;
  TTS_MODEL?: string;
  TTS_VOICE?: string;
  TTS_RATE?: string;
  TTS_REVISION?: string;
  DASHSCOPE_API_KEY?: string;
  TTS_AUDIO?: TtsAudioBinding;
}

/** 생성 Env를 편집하지 않고 이후 라우트가 사용할 교차 타입만 제공한다. */
export type TtsWorkerEnv = Env & TtsEnv;

/** 해시·진단에 사용할 수 있는 비밀 없는 설정. */
export interface TtsConfig {
  provider: typeof TTS_PROVIDER;
  model: typeof TTS_MODEL;
  voice: typeof TTS_VOICE;
  rate: number;
  revision: string;
  region: typeof TTS_REGION;
  outputFormat: typeof TTS_OUTPUT_FORMAT;
  adapterVersion: typeof TTS_ADAPTER_VERSION;
  pronunciationPolicy: typeof TTS_PRONUNCIATION_POLICY;
  endpoint: typeof TTS_ENDPOINT;
  upgradeEndpoint: typeof TTS_UPGRADE_ENDPOINT;
  audioSettings: TtsAudioSettings;
}

/** 네트워크·로그·공개 capability에 절대 전달하지 않는 서버 전용 의존성. */
export interface TtsServerDependencies {
  apiKey: string;
  audio: TtsAudioBinding;
}

export type ResolvedTtsConfig =
  | { status: "disabled"; code: "tts_disabled" }
  | { status: "not_configured"; code: "tts_not_configured" }
  | { status: "ready"; config: TtsConfig; dependencies: TtsServerDependencies };

export type TtsCapability =
  | { enabled: false }
  | { enabled: true; revision: string; maxTextLength: typeof MAX_TTS_TEXT_LENGTH };
