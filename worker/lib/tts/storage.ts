import type { Profile } from "../profiles.ts";
import { MAX_TTS_AUDIO_BYTES, type NormalizedTtsInput, type TtsConfig, type ValidateAudio } from "./types.ts";

const AUDIO_CONTENT_TYPE = "audio/mpeg";
const FORMAT_VERSION = "tts-audio-v1";

/** R2의 필요한 표면만 남겨 실제 binding과 테스트 더블 모두를 받는다. */
export interface TtsAudioStorageBucket {
  get(key: string): Promise<TtsAudioStorageObject | null>;
  put(key: string, value: ArrayBufferView, options: TtsAudioStoragePutOptions): Promise<unknown | null>;
}

export interface TtsAudioStorageObject {
  readonly size: number;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly body: ReadableStream<Uint8Array>;
}

export interface TtsAudioStoragePutOptions {
  readonly onlyIf: Headers;
  readonly httpMetadata: { readonly contentType: typeof AUDIO_CONTENT_TYPE };
  readonly customMetadata: Readonly<Record<string, string>>;
}

export interface StoredAudio {
  readonly bytes: Uint8Array;
  readonly contentType: typeof AUDIO_CONTENT_TYPE;
}

export type PutIfAbsentResult = "saved" | "conflict";

/** R2 객체의 메타데이터나 실제 바이트가 저장 계약에 맞지 않을 때만 사용한다. */
export class TtsStoredAudioError extends Error {
  constructor() {
    super("Stored TTS audio is invalid");
    this.name = "TtsStoredAudioError";
  }
}

export interface TtsAudioMetadataInput {
  readonly config: Pick<TtsConfig, "provider" | "model" | "voice" | "rate" | "revision" | "adapterVersion" | "outputFormat">;
  /** 정규화한 A열의 코드 포인트 수. 원문을 R2 메타데이터에 넣지 않는다. */
  readonly characterCount: number;
}

/**
 * 키 입력은 인증·입력 검증을 마친 값이어야 한다. 프로필 비밀번호·탭·행·세션 등은
 * 포함하지 않아 동일 프로필/시트의 같은 발음 요청을 재사용한다.
 */
export async function buildAudioObjectKey(
  profile: Pick<Profile, "id" | "sheetId">,
  input: NormalizedTtsInput,
  config: TtsConfig,
): Promise<string> {
  const profilePartition = await sha256Hex(JSON.stringify([profile.id, profile.sheetId]));
  const digest = await sha256Hex(JSON.stringify([
    FORMAT_VERSION,
    profile.id,
    profile.sheetId,
    config.revision,
    config.provider,
    config.region,
    config.model,
    config.voice,
    "zh-CN",
    config.rate,
    config.outputFormat,
    config.audioSettings,
    config.adapterVersion,
    config.pronunciationPolicy,
    input.text,
    input.pinyin,
    null,
  ]));
  return `audio/v1/${profilePartition}/${config.revision}/${digest}.mp3`;
}

/** 설정 allowlist와 정규화 문자 수만 R2 customMetadata로 만든다. */
export function createTtsAudioMetadata(
  input: Pick<NormalizedTtsInput, "text">,
  config: TtsAudioMetadataInput["config"],
): TtsAudioMetadataInput {
  return {
    config,
    characterCount: Array.from(input.text).length,
  };
}

export function createTtsAudioStorage(bucket: TtsAudioStorageBucket, validateAudio: ValidateAudio) {
  return {
    async get(key: string, signal?: AbortSignal): Promise<StoredAudio | null> {
      signal?.throwIfAborted();
      const object = await bucket.get(key);
      // R2 get 자체에는 signal 옵션이 없으므로 늦게 도착한 본문도 정리한다.
      if (signal?.aborted) {
        if (object !== null) cancelAudio(object.body, signal.reason);
        throw signal.reason;
      }
      if (object === null) return null;

      if (
        object.httpMetadata?.contentType !== AUDIO_CONTENT_TYPE ||
        !Number.isSafeInteger(object.size) ||
        object.size < 1 ||
        object.size > MAX_TTS_AUDIO_BYTES
      ) {
        const error = new TtsStoredAudioError();
        cancelAudio(object.body, error);
        throw error;
      }

      const bytes = await readBoundedAudio(object.body, signal);
      signal?.throwIfAborted();
      if (bytes.byteLength !== object.size || !validateAudio(bytes, AUDIO_CONTENT_TYPE)) {
        throw new TtsStoredAudioError();
      }
      return { bytes, contentType: AUDIO_CONTENT_TYPE };
    },

    async putIfAbsent(key: string, audio: Uint8Array, metadata: TtsAudioMetadataInput): Promise<PutIfAbsentResult> {
      assertValidAudio(audio, validateAudio);
      const result = await bucket.put(key, audio, {
        onlyIf: new Headers({ "If-None-Match": "*" }),
        httpMetadata: { contentType: AUDIO_CONTENT_TYPE },
        customMetadata: createCustomMetadata(metadata),
      });
      return result === null ? "conflict" : "saved";
    },
  };
}

function assertValidAudio(audio: Uint8Array, validateAudio: ValidateAudio): void {
  if (audio.byteLength < 1 || audio.byteLength > MAX_TTS_AUDIO_BYTES || !validateAudio(audio, AUDIO_CONTENT_TYPE)) {
    throw new TtsStoredAudioError();
  }
}

function createCustomMetadata({ config, characterCount }: TtsAudioMetadataInput): Record<string, string> {
  if (!Number.isSafeInteger(characterCount) || characterCount < 1) throw new TtsStoredAudioError();
  return {
    provider: config.provider,
    model: config.model,
    voice: config.voice,
    rate: String(config.rate),
    revision: config.revision,
    adapterVersion: config.adapterVersion,
    characterCount: String(characterCount),
    formatVersion: FORMAT_VERSION,
  };
}

/** cancel의 지연/실패가 foreground 오류나 deadline을 바꾸지 않게 한다. */
function cancelAudio(source: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>, reason: unknown): void {
  void source.cancel(reason).catch(() => { /* 정리 실패보다 원래 오류가 우선한다. */ });
}

async function readBoundedAudio(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let cancelled = false;
  const cancel = (reason: unknown) => {
    if (cancelled) return;
    cancelled = true;
    cancelAudio(reader, reason);
  };
  const onAbort = () => cancel(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (length + value.byteLength > MAX_TTS_AUDIO_BYTES) throw new TtsStoredAudioError();
      chunks.push(value);
      length += value.byteLength;
    }
  } catch (error) {
    cancel(error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
