import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../profiles.ts";
import { createMp3Fixture } from "./fixtures/mp3.ts";
import { normalizeTtsInput } from "./input.ts";
import { createR2TtsAudioService, createTtsAudioService, TtsServiceError } from "./service.ts";
import { createQwenTtsProvider, type QwenWebSocket } from "./providers/qwen.ts";
import {
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
  type TtsProvider,
} from "./types.ts";

const profile: Pick<Profile, "id" | "sheetId"> = { id: "learner", sheetId: "private-sheet" };
const input = normalizeTtsInput({ text: "经济", pinyin: "jīngjì" });
const config: TtsConfig = {
  provider: TTS_PROVIDER, model: TTS_MODEL, voice: TTS_VOICE, rate: 1, revision: "tts-v1",
  region: TTS_REGION, outputFormat: TTS_OUTPUT_FORMAT, adapterVersion: TTS_ADAPTER_VERSION,
  pronunciationPolicy: TTS_PRONUNCIATION_POLICY, endpoint: TTS_ENDPOINT,
  upgradeEndpoint: TTS_UPGRADE_ENDPOINT, audioSettings: TTS_AUDIO_SETTINGS,
};

function provider(audio = createMp3Fixture(2)): TtsProvider & { synthesize: ReturnType<typeof vi.fn> } {
  return {
    pronunciationMode: "none",
    synthesize: vi.fn().mockResolvedValue({ audio, contentType: "audio/mpeg", billedCharacters: 2 }),
  };
}

function request(signal = new AbortController().signal) {
  return { profile, input, config, signal };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function controlledClock() {
  const timers = new Set<() => void>();
  return {
    clock: {
      now: () => 0,
      setTimeout: (callback: () => void) => { timers.add(callback); return callback; },
      clearTimeout: (callback: unknown) => { timers.delete(callback as () => void); },
    },
    fire: () => {
      for (const timer of [...timers]) {
        timers.delete(timer);
        timer();
      }
    },
  };
}

class SocketDouble implements QwenWebSocket {
  binaryType = "blob";
  accepted = false;
  closed = 0;
  readonly listeners = {
    message: new Set<(event: { data: unknown }) => void>(),
    close: new Set<() => void>(),
    error: new Set<() => void>(),
  };

  accept() { this.accepted = true; }
  send() { /* The adapter's protocol is covered by qwen.test.ts. */ }
  close() { this.closed += 1; }
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close" | "error", listener: () => void): void;
  addEventListener(type: "message" | "close" | "error", listener: ((event: { data: unknown }) => void) | (() => void)) {
    (this.listeners[type] as Set<typeof listener>).add(listener);
  }
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "close" | "error", listener: () => void): void;
  removeEventListener(type: "message" | "close" | "error", listener: ((event: { data: unknown }) => void) | (() => void)) {
    (this.listeners[type] as Set<typeof listener>).delete(listener);
  }
}

afterEach(() => vi.useRealTimers());

describe("createTtsAudioService", () => {
  it("returns a valid R2 hit without contacting the provider or writing", async () => {
    const audio = createMp3Fixture();
    const storage = { get: vi.fn().mockResolvedValue({ bytes: audio, contentType: "audio/mpeg" }), putIfAbsent: vi.fn() };
    const upstream = provider();
    const service = createTtsAudioService({ storage, provider: upstream, createRequestId: () => "request-1" });

    await expect(service(request())).resolves.toMatchObject({ audio, source: "STORED", storage: "PRESENT", pronunciation: "ignored", revision: "tts-v1" });
    expect(upstream.synthesize).not.toHaveBeenCalled();
    expect(storage.putIfAbsent).not.toHaveBeenCalled();
  });

  it("synthesizes text only on a normal miss, validates it, and records a saved result", async () => {
    const storage = { get: vi.fn().mockResolvedValue(null), putIfAbsent: vi.fn().mockResolvedValue("saved") };
    const upstream = provider();
    const registered: Promise<unknown>[] = [];
    const observations: unknown[] = [];
    const service = createTtsAudioService({
      storage, provider: upstream, registerBackgroundTask: (task) => registered.push(task),
      observeStorage: (observation) => observations.push(observation), createRequestId: () => "request-2",
    });

    await expect(service(request())).resolves.toMatchObject({ source: "GENERATED", storage: "SAVED", billedCharacters: 2 });
    expect(upstream.synthesize).toHaveBeenCalledWith({ text: "经济" }, expect.any(AbortSignal));
    expect(storage.putIfAbsent).toHaveBeenCalledTimes(1);
    expect(registered).toHaveLength(1);
    await expect(registered[0]).resolves.toBeUndefined();
    expect(observations).toEqual([expect.objectContaining({ outcome: "saved", requestId: "request-2", revision: "tts-v1" })]);
  });

  it("does not turn read errors, timeouts, or malformed generated audio into a miss", async () => {
    const upstream = provider();
    const unavailable = createTtsAudioService({ storage: { get: vi.fn().mockRejectedValue(new Error("private failure")), putIfAbsent: vi.fn() }, provider: upstream });
    await expect(unavailable(request())).rejects.toMatchObject({ code: "tts_storage_unavailable", status: 503 });
    expect(upstream.synthesize).not.toHaveBeenCalled();

    const malformedStorage = { get: vi.fn().mockResolvedValue(null), putIfAbsent: vi.fn() };
    const malformed = createTtsAudioService({ storage: malformedStorage, provider: provider(new Uint8Array([1, 2, 3])) });
    await expect(malformed(request())).rejects.toMatchObject({ code: "tts_upstream_error", status: 502 });
    expect(malformedStorage.putIfAbsent).not.toHaveBeenCalled();
  });

  it("uses the same write budget for a conflict re-read and returns the winner bytes", async () => {
    const generated = createMp3Fixture(2);
    const winner = createMp3Fixture(3);
    const storage = {
      get: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ bytes: winner, contentType: "audio/mpeg" }),
      putIfAbsent: vi.fn().mockResolvedValue("conflict"),
    };
    const service = createTtsAudioService({ storage, provider: provider(generated), createRequestId: () => "request-3" });

    await expect(service(request())).resolves.toMatchObject({ audio: winner, source: "STORED", storage: "PRESENT", billedCharacters: 2 });
    expect(storage.get).toHaveBeenCalledTimes(2);
    expect(storage.putIfAbsent).toHaveBeenCalledTimes(1);
  });

  it("returns validated generated audio when a put fails while observing the original promise", async () => {
    const late = deferred<"saved" | "conflict">();
    const storage = { get: vi.fn().mockResolvedValue(null), putIfAbsent: vi.fn().mockReturnValue(late.promise) };
    const registered: Promise<unknown>[] = [];
    const observed: unknown[] = [];
    const timing = controlledClock();
    const service = createTtsAudioService({
      storage, provider: provider(), registerBackgroundTask: (task) => registered.push(task),
      observeStorage: (event) => observed.push(event), createRequestId: () => "request-4", clock: timing.clock,
    });
    const result = service(request());
    await vi.waitFor(() => expect(storage.putIfAbsent).toHaveBeenCalledTimes(1));
    timing.fire();
    await expect(result).resolves.toMatchObject({ source: "GENERATED", storage: "UNCONFIRMED" });
    expect(registered).toHaveLength(1);
    let registeredSettled = false;
    void registered[0]!.then(() => { registeredSettled = true; });
    await Promise.resolve();
    expect(registeredSettled).toBe(false);
    late.reject(new Error("late private failure"));
    await expect(registered[0]).resolves.toBeUndefined();
    expect(observed).toEqual([expect.objectContaining({ outcome: "failed", requestId: "request-4" })]);
  });

  it("aborts the provider at the 12-second deadline and preserves caller cancellation reasons", async () => {
    const pending = deferred<{ audio: Uint8Array; contentType: "audio/mpeg" }>();
    const upstream: TtsProvider & { synthesize: ReturnType<typeof vi.fn> } = { pronunciationMode: "none", synthesize: vi.fn(() => pending.promise) };
    const timing = controlledClock();
    const service = createTtsAudioService({ storage: { get: vi.fn().mockResolvedValue(null), putIfAbsent: vi.fn() }, provider: upstream, clock: timing.clock });
    const timed = service(request());
    await vi.waitFor(() => expect(upstream.synthesize).toHaveBeenCalledTimes(1));
    timing.fire();
    await expect(timed).rejects.toMatchObject({ code: "tts_timeout", status: 504 });
    expect(upstream.synthesize.mock.calls[0]![1].aborted).toBe(true);

    const controller = new AbortController();
    const cancelled = service(request(controller.signal));
    const reason = new DOMException("caller cancelled", "AbortError");
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
  });

  it("passes the service deadline into the real Qwen adapter and closes its socket", async () => {
    const socket = new SocketDouble();
    const timing = controlledClock();
    const upstream = createQwenTtsProvider(config, "test-key-not-a-secret", {
      fetch: async () => ({ status: 101, webSocket: socket }),
      randomUUID: () => "e98b7b6d-8204-4b69-9791-78d1e26fe7a9",
    });
    const service = createTtsAudioService({
      storage: { get: vi.fn().mockResolvedValue(null), putIfAbsent: vi.fn() }, provider: upstream, clock: timing.clock,
    });
    const result = service(request());
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    timing.fire();
    await expect(result).rejects.toMatchObject({ code: "tts_timeout" });
    expect(socket.closed).toBe(1);
  });

  it("connects the production factory to real storage and validateMp3 without an external service", async () => {
    const objects = new Map<string, Uint8Array>();
    const bucket = {
      get: vi.fn(async (key: string) => {
        const bytes = objects.get(key);
        return bytes === undefined ? null : {
          size: bytes.byteLength,
          httpMetadata: { contentType: "audio/mpeg" },
          body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
        };
      }),
      put: vi.fn(async (key: string, bytes: Uint8Array) => {
        if (objects.has(key)) return null;
        objects.set(key, new Uint8Array(bytes));
        return { key };
      }),
    };
    const firstProvider = provider();
    const first = createR2TtsAudioService(bucket, { provider: firstProvider });
    await expect(first(request())).resolves.toMatchObject({ source: "GENERATED", storage: "SAVED" });
    const secondProvider = provider();
    const second = createR2TtsAudioService(bucket, { provider: secondProvider });
    await expect(second(request())).resolves.toMatchObject({ source: "STORED", storage: "PRESENT" });
    expect(secondProvider.synthesize).not.toHaveBeenCalled();
  });
});

describe("TtsServiceError", () => {
  it("uses the shared public response without preserving private causes", () => {
    const error = new TtsServiceError("tts_storage_unavailable");
    expect(error).toMatchObject({ code: "tts_storage_unavailable", status: 503, message: "발음 저장소를 사용할 수 없습니다." });
    expect(JSON.stringify(error)).not.toContain("private");
  });
});
