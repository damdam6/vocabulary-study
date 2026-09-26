import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../profiles.ts";
import { createMp3Fixture } from "./fixtures/mp3.ts";
import { normalizeTtsInput } from "./input.ts";
import { createR2TtsAudioService, createTtsAudioService, TtsServiceError } from "./service.ts";
import { createQwenTtsProvider, type QwenWebSocket } from "./providers/qwen.ts";
import type { TtsAudioStorageObject } from "./storage.ts";
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
  it.each(["deadline", "abort"])("observes a read rejected while starting at the %s boundary", async (cause) => {
    let now = 0;
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const upstream = provider();
    let readSignal: AbortSignal | undefined;
    const storage = {
      get: vi.fn((_key: string, signal?: AbortSignal) => {
        readSignal = signal;
        if (cause === "abort") controller.abort(reason);
        else now = 2000;
        return Promise.reject(new Error("late read failure"));
      }),
      putIfAbsent: vi.fn(),
    };
    const timing = controlledClock();
    const result = createTtsAudioService({ storage, provider: upstream, clock: { ...timing.clock, now: () => now } })(request(controller.signal));
    if (cause === "abort") await expect(result).rejects.toBe(reason);
    else await expect(result).rejects.toMatchObject({ code: "tts_storage_unavailable" });
    expect(readSignal?.aborted).toBe(true);
    expect(upstream.synthesize).not.toHaveBeenCalled();
  });

  it.each(["deadline", "abort"])("cleans a pending R2 reader on %s without synthesizing", async (cause) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const bucket = { get: vi.fn().mockResolvedValue({ size: 417, httpMetadata: { contentType: "audio/mpeg" }, body }), put: vi.fn() };
    const timing = controlledClock();
    const upstream = provider();
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const result = createR2TtsAudioService(bucket, { provider: upstream, clock: timing.clock })(request(controller.signal));
    const assertion = cause === "abort" ? expect(result).rejects.toBe(reason) : expect(result).rejects.toMatchObject({ code: "tts_storage_unavailable" });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    if (cause === "abort") controller.abort(reason);
    else timing.fire();
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(upstream.synthesize).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it.each(["deadline", "abort"])("cancels an R2 object arriving after %s and consumes cancel rejection", async (cause) => {
    const late = deferred<TtsAudioStorageObject>();
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const bucket = { get: vi.fn().mockReturnValue(late.promise), put: vi.fn() };
    const timing = controlledClock();
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const upstream = provider();
    const result = createR2TtsAudioService(bucket, { provider: upstream, clock: timing.clock })(request(controller.signal));
    const assertion = cause === "abort" ? expect(result).rejects.toBe(reason) : expect(result).rejects.toMatchObject({ code: "tts_storage_unavailable" });
    await vi.waitFor(() => expect(bucket.get).toHaveBeenCalledTimes(1));
    if (cause === "abort") controller.abort(reason);
    else timing.fire();
    await assertion;
    late.resolve({ size: 417, httpMetadata: { contentType: "audio/mpeg" }, body });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(body.locked).toBe(false);
    expect(upstream.synthesize).not.toHaveBeenCalled();
  });

  it("cleans conflict re-reads within the remaining write budget and preserves put observation", async () => {
    let now = 0;
    const timing = controlledClock();
    const setTimeout = vi.fn(timing.clock.setTimeout);
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const put = deferred<null>();
    const bucket = {
      get: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ size: 417, httpMetadata: { contentType: "audio/mpeg" }, body }),
      put: vi.fn().mockReturnValue(put.promise),
    };
    const audio = createMp3Fixture();
    const observed = vi.fn();
    const background: Promise<unknown>[] = [];
    const result = createR2TtsAudioService(bucket, {
      provider: provider(audio), clock: { ...timing.clock, now: () => now, setTimeout },
      observeStorage: observed, registerBackgroundTask: (promise) => background.push(promise),
    })(request());
    await vi.waitFor(() => expect(bucket.put).toHaveBeenCalledTimes(1));
    now = 1500;
    put.resolve(null);
    await vi.waitFor(() => expect(body.locked).toBe(true));
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 500);
    now = 2000;
    timing.fire();
    await expect(result).resolves.toMatchObject({ audio, source: "GENERATED", storage: "UNCONFIRMED" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    await Promise.all(background);
    expect(observed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "conflict" }));
  });

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

  it("counts synchronous MP3 validation time in the synthesis deadline", async () => {
    let now = 0;
    const timers = new Set<() => void>();
    let providerSignal: AbortSignal | undefined;
    const upstream: TtsProvider = {
      pronunciationMode: "none",
      synthesize: vi.fn((_input, signal) => {
        providerSignal = signal;
        return Promise.resolve({ audio: createMp3Fixture(), contentType: "audio/mpeg" as const });
      }),
    };
    const storage = { get: vi.fn().mockResolvedValue(null), putIfAbsent: vi.fn() };
    const service = createTtsAudioService({
      storage,
      provider: upstream,
      clock: {
        now: () => now,
        setTimeout: (callback) => { timers.add(callback); return callback; },
        clearTimeout: (callback) => { timers.delete(callback as () => void); },
      },
      validateAudio: () => {
        // provider는 deadline 전 완료했지만, 동기 형식 검사가 예산을 소진한 경계다.
        now = 12_000;
        return true;
      },
    });

    await expect(service(request())).rejects.toMatchObject({ code: "tts_timeout", status: 504 });
    expect(providerSignal?.aborted).toBe(true);
    expect(storage.putIfAbsent).not.toHaveBeenCalled();
    expect(timers).toHaveLength(0);
  });

  it("preserves a caller abort observed immediately after MP3 validation", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled during validation", "AbortError");
    const storage = { get: vi.fn().mockResolvedValue(null), putIfAbsent: vi.fn() };
    const service = createTtsAudioService({
      storage,
      provider: provider(),
      validateAudio: () => {
        controller.abort(reason);
        return true;
      },
    });

    await expect(service(request(controller.signal))).rejects.toBe(reason);
    expect(storage.putIfAbsent).not.toHaveBeenCalled();
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
