import { describe, expect, it } from "vitest";
import { createMp3Fixture } from "../fixtures/mp3.ts";
import {
  MAX_TTS_AUDIO_BYTES,
  MAX_TTS_PROVIDER_JSON_BYTES,
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
  type TtsConfig,
} from "../types.ts";
import { createQwenClientMessages, createQwenEventProcessor } from "./qwenProtocol.ts";

const TASK_ID = "2bf83b9a-baeb-4fda-8d9a-123456789abc";
const OTHER_ID = "3bf83b9a-baeb-4fda-8d9a-123456789abc";
const config: TtsConfig = {
  provider: TTS_PROVIDER, model: TTS_MODEL, voice: TTS_VOICE, rate: 1, revision: "tts-v1",
  region: TTS_REGION, outputFormat: TTS_OUTPUT_FORMAT, adapterVersion: TTS_ADAPTER_VERSION,
  pronunciationPolicy: TTS_PRONUNCIATION_POLICY, endpoint: TTS_ENDPOINT,
  upgradeEndpoint: TTS_UPGRADE_ENDPOINT, audioSettings: TTS_AUDIO_SETTINGS,
};

const event = (name: string, payload: Record<string, unknown> = {}, taskId = TASK_ID, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ header: { task_id: taskId, event: name, ...extra }, payload });

describe("createQwenClientMessages", () => {
  it("serializes the four official messages with one task ID", () => {
    const messages = createQwenClientMessages(TASK_ID, config, { text: "你好，\"世界\"\n下一行" });
    expect(JSON.parse(messages.runTask)).toEqual({
      header: { action: "run-task", task_id: TASK_ID, streaming: "duplex" },
      payload: {
        task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: TTS_MODEL,
        parameters: {
          text_type: "PlainText", voice: TTS_VOICE, format: "mp3", sample_rate: 24000,
          bit_rate: 128, volume: 50, rate: 1, pitch: 1, seed: 0,
          language_hints: ["zh"], enable_ssml: false,
        },
        input: {},
      },
    });
    expect(JSON.parse(messages.continueTask)).toEqual({
      header: { action: "continue-task", task_id: TASK_ID, streaming: "duplex" },
      payload: { input: { text: "你好，\"世界\"\n下一行" } },
    });
    expect(JSON.parse(messages.finishTask)).toEqual({
      header: { action: "finish-task", task_id: TASK_ID, streaming: "duplex" }, payload: { input: {} },
    });
    expect(JSON.parse(messages.cancelTask)).toEqual({
      header: { action: "finish-task", task_id: TASK_ID, streaming: "duplex" }, payload: { input: { directive: "cancel" } },
    });
    const serialized = Object.values(messages).join("\n");
    for (const forbidden of ["pinyin", "apiKey", "DASHSCOPE", "endpoint", "instruction", "hot_fix", "enable_ssml\":true"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects a non-UUID task ID", () => {
    expect(() => createQwenClientMessages("not-a-uuid", config, { text: "你好" })).toThrow(TypeError);
  });
});

describe("createQwenEventProcessor", () => {
  it("assembles interleaved binary chunks and takes the latest valid usage", () => {
    const processor = createQwenEventProcessor(TASK_ID);
    const audio = createMp3Fixture(2);
    expect(processor.push(event("task-started"))).toEqual({ status: "pending" });
    expect(processor.push(event("result-generated", { output: { type: "sentence-synthesis" }, usage: { characters: 2 } }))).toEqual({ status: "pending" });
    processor.push(audio.subarray(0, 173));
    processor.push(event("result-generated", { output: { type: "sentence-end" }, usage: { characters: 4 } }));
    processor.push(audio.subarray(173));
    const result = processor.push(event("task-finished", { usage: { characters: 5 } }));
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.audio).toEqual(audio);
      expect(result.contentType).toBe("audio/mpeg");
      expect(result.billedCharacters).toBe(5);
    }
  });

  it("does not infer usage and ignores invalid usage values", () => {
    for (const characters of [undefined, "4", -1, 1.5, 9_007_199_254_740_992]) {
      const processor = createQwenEventProcessor(TASK_ID);
      processor.push(event("task-started"));
      processor.push(createMp3Fixture(1));
      const result = processor.push(event("task-finished", characters === undefined ? {} : { usage: { characters } }));
      expect(result).not.toHaveProperty("billedCharacters");
    }
  });

  it.each([
    ["result before start", [event("result-generated", { output: {} })]],
    ["binary before start", [createMp3Fixture(1)]],
    ["finish before start", [event("task-finished")]],
    ["duplicate start", [event("task-started"), event("task-started")]],
    ["wrong task", [event("task-started", {}, OTHER_ID)]],
    ["unknown event", [event("mystery")]],
    ["malformed JSON", ["{"]],
    ["primitive JSON", ["null"]],
    ["array JSON", ["[]"]],
    ["missing payload", [JSON.stringify({ header: { task_id: TASK_ID, event: "task-started" } })]],
  ])("fails on %s", (_name, messages) => {
    const processor = createQwenEventProcessor(TASK_ID);
    let result = { status: "pending" } as ReturnType<typeof processor.push>;
    for (const message of messages) result = processor.push(message);
    expect(result).toEqual({ status: "failed", code: "tts_upstream_error" });
  });

  it("fails terminal reuse, premature end, empty and corrupt completed audio", () => {
    const completed = createQwenEventProcessor(TASK_ID);
    completed.push(event("task-started"));
    completed.push(createMp3Fixture(1));
    completed.push(event("task-finished"));
    expect(completed.push(event("task-finished"))).toEqual({ status: "failed", code: "tts_upstream_error" });

    expect(createQwenEventProcessor(TASK_ID).end()).toEqual({ status: "failed", code: "tts_upstream_error" });
    for (const audio of [new Uint8Array(), new TextEncoder().encode("not mp3")]) {
      const processor = createQwenEventProcessor(TASK_ID);
      processor.push(event("task-started"));
      if (audio.length > 0) processor.push(audio);
      expect(processor.push(event("task-finished"))).toEqual({ status: "failed", code: "tts_upstream_error" });
    }
  });

  it.each([
    ["InvalidApiKey", "tts_unavailable"], ["AccessDenied.Unpurchased", "tts_unavailable"],
    ["AllocationQuota.FreeTierOnly", "tts_unavailable"], ["Throttling", "tts_unavailable"],
    ["Throttling.RateQuota", "tts_unavailable"], ["Throttling.AllocationQuota", "tts_unavailable"],
    ["InvalidParameter", "tts_upstream_error"], ["Unknown", "tts_upstream_error"], ["", "tts_upstream_error"],
  ])("maps task failure %s without exposing its message", (errorCode, expected) => {
    const processor = createQwenEventProcessor(TASK_ID);
    const result = processor.push(event("task-failed", {}, TASK_ID, { error_code: errorCode, error_message: "SECRET SENTINEL" }));
    expect(result).toEqual({ status: "failed", code: expected });
    expect(JSON.stringify(result)).not.toContain("SECRET SENTINEL");
  });

  it("enforces JSON and binary limits before accepting data", () => {
    const oversizedJson = event("task-started") + " ".repeat(MAX_TTS_PROVIDER_JSON_BYTES);
    expect(createQwenEventProcessor(TASK_ID).push(oversizedJson)).toEqual({ status: "failed", code: "tts_upstream_error" });

    const processor = createQwenEventProcessor(TASK_ID);
    processor.push(event("task-started"));
    expect(processor.push(new Uint8Array(MAX_TTS_AUDIO_BYTES))).toEqual({ status: "pending" });
    expect(processor.push(new Uint8Array(1))).toEqual({ status: "failed", code: "tts_upstream_error" });
  });

  it("enforces the cumulative JSON limit", () => {
    const processor = createQwenEventProcessor(TASK_ID);
    processor.push(event("task-started"));
    const base = event("result-generated", { output: {} });
    const large = base + " ".repeat(MAX_TTS_PROVIDER_JSON_BYTES - new TextEncoder().encode(base).length);
    for (let index = 0; index < 15; index += 1) {
      expect(processor.push(large)).toEqual({ status: "pending" });
    }
    expect(processor.push(large)).toEqual({ status: "failed", code: "tts_upstream_error" });
  });
});
