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
    async get(key: string): Promise<StoredAudio | null> {
      const object = await bucket.get(key);
      if (object === null) return null;

      if (
        object.httpMetadata?.contentType !== AUDIO_CONTENT_TYPE ||
        !Number.isSafeInteger(object.size) ||
        object.size < 1 ||
        object.size > MAX_TTS_AUDIO_BYTES
      ) {
        throw new TtsStoredAudioError();
      }

      const bytes = await readBoundedAudio(object.body);
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

async function readBoundedAudio(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_TTS_AUDIO_BYTES) throw new TtsStoredAudioError();
      chunks.push(value);
      length += value.byteLength;
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // 원래 읽기/검증 오류보다 stream 정리 오류가 우선하지 않는다.
    }
    throw error;
  } finally {
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
