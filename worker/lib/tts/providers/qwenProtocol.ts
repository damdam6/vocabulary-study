import { validateMp3 } from "../audio.ts";
import {
  MAX_TTS_AUDIO_BYTES,
  MAX_TTS_PROVIDER_JSON_BYTES,
  MAX_TTS_PROVIDER_TOTAL_BYTES,
  type SynthesisInput,
  type TtsConfig,
  type TtsErrorCode,
} from "../types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNAVAILABLE_CODES = new Set([
  "InvalidApiKey", "invalid_api_key", "AccessDenied.Unpurchased", "Workspace.AccessDenied",
  "Endpoint.AccessDenied", "AllocationQuota.FreeTierOnly", "CommodityNotPurchased",
  "Throttling", "Throttling.RateQuota", "Throttling.AllocationQuota",
  "LimitRequests", "limit_requests", "insufficient_quota",
]);

export interface QwenClientMessages {
  runTask: string;
  continueTask: string;
  finishTask: string;
  cancelTask: string;
}

export type QwenProtocolUpdate =
  | { status: "pending" }
  | { status: "completed"; audio: Uint8Array; contentType: "audio/mpeg"; billedCharacters?: number }
  | { status: "failed"; code: Extract<TtsErrorCode, "tts_unavailable" | "tts_upstream_error"> };

export interface QwenEventProcessor {
  push(message: string | Uint8Array): QwenProtocolUpdate;
  end(): QwenProtocolUpdate;
}

export function createQwenClientMessages(taskId: string, config: TtsConfig, input: SynthesisInput): QwenClientMessages {
  assertTaskId(taskId);
  const header = (action: "run-task" | "continue-task" | "finish-task") => ({ action, task_id: taskId, streaming: "duplex" });
  const [sampleRate, bitRate, volume, pitch, seed, languageHints, enableSsml] = config.audioSettings;
  return {
    runTask: JSON.stringify({
      header: header("run-task"),
      payload: {
        task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: config.model,
        parameters: {
          text_type: "PlainText", voice: config.voice, format: config.outputFormat,
          sample_rate: sampleRate, bit_rate: bitRate, volume, rate: config.rate, pitch, seed,
          language_hints: [...languageHints], enable_ssml: enableSsml,
        },
        input: {},
      },
    }),
    continueTask: JSON.stringify({ header: header("continue-task"), payload: { input: { text: input.text } } }),
    finishTask: JSON.stringify({ header: header("finish-task"), payload: { input: {} } }),
    cancelTask: JSON.stringify({ header: header("finish-task"), payload: { input: { directive: "cancel" } } }),
  };
}

export function createQwenEventProcessor(taskId: string): QwenEventProcessor {
  assertTaskId(taskId);
  let state: "awaiting-start" | "streaming" | "finished" | "failed" = "awaiting-start";
  let jsonBytes = 0;
  let audioBytes = 0;
  let billedCharacters: number | undefined;
  let completion: Extract<QwenProtocolUpdate, { status: "completed" }> | undefined;
  const chunks: Uint8Array[] = [];
  const failed = (code: "tts_unavailable" | "tts_upstream_error" = "tts_upstream_error"): QwenProtocolUpdate => {
    state = "failed";
    chunks.length = 0;
    audioBytes = 0;
    return { status: "failed", code };
  };

  const push = (message: string | Uint8Array): QwenProtocolUpdate => {
    if (state === "finished" || state === "failed") return failed();
    if (message instanceof Uint8Array) {
      if (state !== "streaming" || message.length === 0 || audioBytes + message.length > MAX_TTS_AUDIO_BYTES) return failed();
      chunks.push(message);
      audioBytes += message.length;
      return { status: "pending" };
    }

    const size = new TextEncoder().encode(message).length;
    if (size > MAX_TTS_PROVIDER_JSON_BYTES || jsonBytes + size > MAX_TTS_PROVIDER_TOTAL_BYTES) return failed();
    jsonBytes += size;
    const event = parseEvent(message);
    if (!event || event.header.task_id !== taskId) return failed();

    switch (event.header.event) {
      case "task-started":
        if (state !== "awaiting-start") return failed();
        state = "streaming";
        return { status: "pending" };
      case "result-generated":
        if (state !== "streaming" || !isRecord(event.payload.output)) return failed();
        billedCharacters = readUsage(event.payload, billedCharacters);
        return { status: "pending" };
      case "task-failed":
        return failed(UNAVAILABLE_CODES.has(event.header.error_code ?? "") ? "tts_unavailable" : "tts_upstream_error");
      case "task-finished": {
        if (state !== "streaming") return failed();
        billedCharacters = readUsage(event.payload, billedCharacters);
        if (audioBytes === 0) return failed();
        const audio = new Uint8Array(audioBytes);
        let offset = 0;
        for (const chunk of chunks) {
          audio.set(chunk, offset);
          offset += chunk.length;
        }
        if (!validateMp3(audio, "audio/mpeg")) return failed();
        state = "finished";
        completion = billedCharacters === undefined
          ? { status: "completed", audio, contentType: "audio/mpeg" }
          : { status: "completed", audio, contentType: "audio/mpeg", billedCharacters };
        return completion;
      }
    }
  };

  return { push, end: () => completion ?? failed() };
}

type ServerEvent = {
  header: { task_id: string; event: "task-started" | "result-generated" | "task-finished" | "task-failed"; error_code?: string };
  payload: Record<string, unknown>;
};

function parseEvent(message: string): ServerEvent | null {
  try {
    const value: unknown = JSON.parse(message);
    if (!isRecord(value) || !isRecord(value.header) || !isRecord(value.payload)) return null;
    const taskId = value.header.task_id;
    const event = value.header.event;
    if (typeof taskId !== "string" || !UUID_PATTERN.test(taskId) ||
      (event !== "task-started" && event !== "result-generated" && event !== "task-finished" && event !== "task-failed")) return null;
    if (event === "task-failed" && value.header.error_code !== undefined && typeof value.header.error_code !== "string") return null;
    return { header: { task_id: taskId, event, ...(typeof value.header.error_code === "string" ? { error_code: value.header.error_code } : {}) }, payload: value.payload };
  } catch {
    return null;
  }
}

function readUsage(payload: Record<string, unknown>, previous: number | undefined): number | undefined {
  if (!isRecord(payload.usage)) return previous;
  const characters = payload.usage.characters;
  return typeof characters === "number" && Number.isSafeInteger(characters) && characters >= 0 ? characters : previous;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertTaskId(taskId: string): void {
  if (!UUID_PATTERN.test(taskId)) throw new TypeError("Qwen task ID must be a UUID");
}
