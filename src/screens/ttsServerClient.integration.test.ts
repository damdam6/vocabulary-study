// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index.ts";
import { createMp3Fixture } from "../../worker/lib/tts/fixtures/mp3.ts";
import { makeEnv, makeExecutionContext } from "../../worker/test-utils.ts";
import { createPronunciationController } from "../lib/speak.ts";
import { createTtsAudioOutput } from "../lib/ttsAudio.ts";
import { fetchTtsAudio } from "../lib/ttsApi.ts";
import { createTtsBlobCache } from "../lib/ttsBlobCache.ts";

const webcrypto = globalThis.crypto;

class Socket {
  binaryType = "blob"; accepted = false; sent: string[] = [];
  private listeners = new Set<(event: { data: unknown }) => void>();
  accept() { this.accepted = true; } close() {}
  send(value: string) { this.sent.push(value); }
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(_type: "close" | "error", _listener: () => void): void;
  addEventListener(type: "message" | "close" | "error", listener: ((event: { data: unknown }) => void) | (() => void)) { if (type === "message") this.listeners.add(listener as (event: { data: unknown }) => void); }
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(_type: "close" | "error", _listener: () => void): void;
  removeEventListener(type: "message" | "close" | "error", listener: ((event: { data: unknown }) => void) | (() => void)) { if (type === "message") this.listeners.delete(listener as (event: { data: unknown }) => void); }
  emit(value: unknown) { for (const listener of this.listeners) listener({ data: value }); }
}

class Bucket {
  bytes = new Map<string, Uint8Array>(); puts = 0;
  async get(key: string) { const value = this.bytes.get(key); return value ? { size: value.byteLength, httpMetadata: { contentType: "audio/mpeg" }, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(value.slice()); controller.close(); } }) } : null; }
  async put(key: string, value: ArrayBufferView, options: { onlyIf: Headers }) { expect(options.onlyIf.get("If-None-Match")).toBe("*"); if (this.bytes.has(key)) return null; this.puts++; this.bytes.set(key, new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()); return { etag: "saved" }; }
}

class AudioDouble {
  currentTime = 0; ended = false; error: unknown = null; calls: string[] = []; attrs = new Map<string, string>();
  play() { this.calls.push("play"); return Promise.resolve(); } pause() { this.calls.push("pause"); } load() {}
  removeAttribute(name: string) { this.attrs.delete(name); } getAttribute(name: string) { return this.attrs.get(name) ?? null; } setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  addEventListener() {} removeEventListener() {}
}

const profiles = JSON.stringify([{ id: "zh", name: "중국어", password: "pw", sheetId: "sheet", modes: ["m1"], contentType: "zh" }]);

async function complete(socket: Socket, bytes: Uint8Array) {
  await vi.waitFor(() => expect(socket.accepted).toBe(true));
  const task = JSON.parse(socket.sent[0]!).header.task_id;
  const event = (name: string, payload: object = {}) => JSON.stringify({ header: { task_id: task, event: name }, payload });
  socket.emit(event("task-started")); socket.emit(event("result-generated", { output: { type: "sentence-synthesis" } }));
  socket.emit(bytes.buffer.slice(0, 384)); socket.emit(event("result-generated", { output: { type: "sentence-synthesis" } })); socket.emit(bytes.buffer.slice(384)); socket.emit(event("task-finished"));
}

describe("#150 S1/S3 Worker에서 실제 클라이언트 소비", () => {
  it("S1은 새 controller/cache가 저장 바이트를 재생하고 S3 UNCONFIRMED는 fetch 없이 replay한다", async () => {
    vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("localStorage", { getItem: () => "pw", setItem() {}, removeItem() {} }); vi.spyOn(console, "info").mockImplementation(() => {});
    const bucket = new Bucket(); let socket = new Socket(); let context = makeExecutionContext(); let routes = 0; let writeFails = false;
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      if (input !== "/api/tts") return { status: 101, webSocket: socket };
      routes++; const active = writeFails ? { get: bucket.get.bind(bucket), put: async () => { throw new Error("write failed"); } } : bucket;
      return worker.fetch(new Request("https://test/api/tts", { ...init, headers: init.headers }) as Parameters<typeof worker.fetch>[0], makeEnv({ PROFILES: profiles, TTS_ENABLED: "true", DASHSCOPE_API_KEY: "test", TTS_AUDIO: active }), context);
    });
    vi.stubGlobal("fetch", fetchMock);
    const blobs: Blob[] = [];
    const client = () => { const native = new AudioDouble(); const controller = createPronunciationController({ profileId: "zh", capability: { enabled: true, revision: "tts-v1", maxTextLength: 200 }, transport: fetchTtsAudio, cache: createTtsBlobCache(), audio: createTtsAudioOutput({ createAudio: () => native, createObjectURL: (blob) => { blobs.push(blob); return `blob:${blobs.length}`; }, revokeObjectURL() {} }) }); return { native, controller }; };
    const bytes = createMp3Fixture(2); const first = client(); first.controller.activate("one", { text: "经济", pinyin: "jīngjì" }); first.controller.reveal("one"); await complete(socket, bytes); await vi.waitFor(() => expect(first.controller.getSnapshot().status).toBe("playing")); await vi.waitFor(() => expect(first.native.calls).toContain("play")); await context.drain(); first.controller.dispose();
    const second = client(); second.controller.activate("two", { text: "经济", pinyin: "jīngjì" }); second.controller.reveal("two"); await vi.waitFor(() => expect(second.controller.getSnapshot().status).toBe("playing")); expect(second.native.calls).toContain("play"); expect(routes).toBe(2); expect(bucket.puts).toBe(1); expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(bytes); expect(new Uint8Array(await blobs[1]!.arrayBuffer())).toEqual(bytes); second.controller.dispose();
    bucket.bytes.clear(); socket = new Socket(); context = makeExecutionContext(); writeFails = true; const third = client(); third.controller.activate("three", { text: "经济", pinyin: "jīngjì" }); third.controller.reveal("three"); await complete(socket, bytes); await vi.waitFor(() => expect(third.native.calls).toContain("play")); const beforeReplay = routes; third.controller.replay("three"); await vi.waitFor(() => expect(third.native.calls.filter((call) => call === "play")).toHaveLength(2)); expect(routes).toBe(beforeReplay); third.controller.dispose(); await context.drain();
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
