import { apiFetch } from "./api.ts";
import {
  TTS_ERROR_CODES,
  type TtsAudioResponse,
  type TtsErrorCode,
  type TtsPronunciation,
  type TtsRequest,
  type TtsTransport,
  type TtsTransportFailure,
} from "./ttsTypes.ts";

const TTS_PREPARE_TIMEOUT_MS = 20_000;
const TTS_MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const TTS_MAX_ERROR_BYTES = 64 * 1024;

function failure(kind: Exclude<TtsTransportFailure["kind"], "http">): TtsTransportFailure {
  return { kind };
}

function isTtsErrorCode(value: unknown): value is TtsErrorCode {
  return typeof value === "string" && (TTS_ERROR_CODES as readonly string[]).includes(value);
}

async function readBounded(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw failure("invalid_response");

  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const result = await raceWithAbort(reader.read(), signal);
      if (result.done) {
        completed = true;
        break;
      }
      total += result.value.byteLength;
      if (total > maximumBytes) throw failure("invalid_response");
      chunks.push(result.value);
    }
  } finally {
    if (!completed) {
      void reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

async function parseHttpFailure(response: Response, signal: AbortSignal): Promise<TtsTransportFailure> {
  try {
    const bytes = await readBounded(response, TTS_MAX_ERROR_BYTES, signal);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== "object" || value === null) return failure("invalid_response");
    const { error, message } = value as Record<string, unknown>;
    if (!isTtsErrorCode(error) || typeof message !== "string" || message.length === 0) {
      return failure("invalid_response");
    }
    return { kind: "http", status: response.status, error, message };
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error) throw error;
    return failure("invalid_response");
  }
}

function parseSuccessHeaders(response: Response): Omit<TtsAudioResponse, "audio"> {
  const mediaType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  const source = response.headers.get("X-TTS-Source");
  const storage = response.headers.get("X-TTS-Storage");
  const pronunciation = response.headers.get("X-TTS-Pronunciation");
  const revision = response.headers.get("X-TTS-Revision");

  if (
    mediaType !== "audio/mpeg" ||
    (pronunciation !== "absent" && pronunciation !== "ignored") ||
    revision === null ||
    revision.trim().length === 0
  ) {
    throw failure("invalid_response");
  }

  const common = { pronunciation: pronunciation as TtsPronunciation, revision };
  if (source === "STORED" && storage === "PRESENT") return { source, storage, ...common };
  if (source === "GENERATED" && (storage === "SAVED" || storage === "UNCONFIRMED")) {
    return { source, storage, ...common };
  }
  throw failure("invalid_response");
}

export const fetchTtsAudio: TtsTransport = async (input, externalSignal) => {
  if (externalSignal.aborted) throw failure("aborted");

  const controller = new AbortController();
  let abortFailure: TtsTransportFailure | null = null;
  const abortWith = (reason: TtsTransportFailure) => {
    if (abortFailure !== null) return;
    abortFailure = reason;
    controller.abort(reason);
  };
  const onExternalAbort = () => abortWith(failure("aborted"));
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(() => abortWith(failure("timeout")), TTS_PREPARE_TIMEOUT_MS);

  try {
    const body: TtsRequest = input.pinyin === undefined
      ? { text: input.text }
      : { text: input.text, pinyin: input.pinyin };
    const response = await raceWithAbort(apiFetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    }), controller.signal);

    if (!response.ok) throw await parseHttpFailure(response, controller.signal);

    const diagnostics = parseSuccessHeaders(response);
    const contentLength = response.headers.get("Content-Length");
    if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > TTS_MAX_AUDIO_BYTES) {
      void response.body?.cancel().catch(() => undefined);
      throw failure("invalid_response");
    }

    const bytes = await readBounded(response, TTS_MAX_AUDIO_BYTES, controller.signal);
    if (bytes.byteLength === 0) throw failure("invalid_response");
    return { audio: new Blob([new Uint8Array(bytes).buffer], { type: "audio/mpeg" }), ...diagnostics } as TtsAudioResponse;
  } catch (error) {
    if (abortFailure !== null) throw abortFailure;
    if (typeof error === "object" && error !== null && "kind" in error) throw error;
    throw failure("network");
  } finally {
    clearTimeout(timeout);
    externalSignal.removeEventListener("abort", onExternalAbort);
  }
};
