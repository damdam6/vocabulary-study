import { describe, expect, it } from "vitest";
import { createMp3Fixture } from "../fixtures/mp3.ts";
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
} from "../types.ts";
import { createQwenTtsProvider, QwenTtsError, type QwenUpgradeResponse, type QwenWebSocket } from "./qwen.ts";

const TASK_ID = "2bf83b9a-baeb-4fda-8d9a-123456789abc";
const API_KEY = "QWEN_API_KEY_SENTINEL";
const TEXT = "원문 sentinel: 你好";
const config: TtsConfig = {
  provider: TTS_PROVIDER, model: TTS_MODEL, voice: TTS_VOICE, rate: 1, revision: "tts-v1",
  region: TTS_REGION, outputFormat: TTS_OUTPUT_FORMAT, adapterVersion: TTS_ADAPTER_VERSION,
  pronunciationPolicy: TTS_PRONUNCIATION_POLICY, endpoint: TTS_ENDPOINT,
  upgradeEndpoint: TTS_UPGRADE_ENDPOINT, audioSettings: TTS_AUDIO_SETTINGS,
};

class SocketDouble implements QwenWebSocket {
  #binaryType = "blob";
  accepted = false;
  closed = 0;
  sends: string[] = [];
  events: string[] = [];
  throwOn: "accept" | "send" | "close" | "listener" | undefined;
  readonly listeners = { message: new Set<(event: { data: unknown }) => void>(), close: new Set<() => void>(), error: new Set<() => void>() };

  get binaryType() { return this.#binaryType; }
  set binaryType(value: string) { this.events.push(`binaryType:${value}`); this.#binaryType = value; }
  accept() { this.events.push("accept"); if (this.throwOn === "accept") throw new Error("provider error sentinel"); this.accepted = true; }
  send(message: string) { this.events.push("send"); if (this.throwOn === "send") throw new Error("provider error sentinel"); this.sends.push(message); }
  close() { this.events.push("close"); this.closed += 1; if (this.throwOn === "close") throw new Error("provider error sentinel"); }
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close" | "error", listener: () => void): void;
  addEventListener(type: "message" | "close" | "error", listener: ((event: { data: unknown }) => void) | (() => void)) {
    this.events.push(`add:${type}`);
    if (this.throwOn === "listener") throw new Error("provider error sentinel");
    (this.listeners[type] as Set<typeof listener>).add(listener);
  }
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "close" | "error", listener: () => void): void;
  removeEventListener(type: "message" | "close" | "error", listener: ((event: { data: unknown }) => void) | (() => void)) {
    this.events.push(`remove:${type}`);
    (this.listeners[type] as Set<typeof listener>).delete(listener);
  }
  emitMessage(data: unknown) { for (const listener of [...this.listeners.message]) listener({ data }); }
  emitClose() { for (const listener of [...this.listeners.close]) listener(); }
  emitError() { for (const listener of [...this.listeners.error]) listener(); }
  listenerCount() { return this.listeners.message.size + this.listeners.close.size + this.listeners.error.size; }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const response = (socket: SocketDouble | null, status = 101): QwenUpgradeResponse => ({ status, webSocket: socket });
const event = (name: string, payload: Record<string, unknown> = {}) => JSON.stringify({ header: { task_id: TASK_ID, event: name }, payload });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("createQwenTtsProvider", () => {
  it("performs the fixed Upgrade, installs listeners before accept, and returns only completed MP3", async () => {
    const socket = new SocketDouble();
    let request: { input: string; init: RequestInit } | undefined;
    const controller = new AbortController();
    const provider = createQwenTtsProvider(config, API_KEY, {
      fetch: async (input, init) => { request = { input, init }; return response(socket); },
      randomUUID: () => TASK_ID,
    });
    const result = provider.synthesize({ text: TEXT }, controller.signal);
    await tick();
    expect(request?.input).toBe(TTS_UPGRADE_ENDPOINT);
    expect(request?.init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(new Headers(request?.init.headers).get("upgrade")).toBe("websocket");
    expect(new Headers(request?.init.headers).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(socket.events.slice(0, 5)).toEqual(["binaryType:arraybuffer", "add:message", "add:close", "add:error", "accept"]);
    expect(socket.sends).toHaveLength(1);
    expect(JSON.parse(socket.sends[0]!).header.action).toBe("run-task");

    socket.emitMessage(event("task-started"));
    expect(socket.sends.map((message) => JSON.parse(message).header.action)).toEqual(["run-task", "continue-task", "finish-task"]);
    expect(JSON.parse(socket.sends[1]!).payload.input.text).toBe(TEXT);
    socket.emitMessage(event("result-generated", { output: { type: "sentence-synthesis" } }));
    const audio = createMp3Fixture(2);
    socket.emitMessage(audio.buffer.slice(0, 384));
    socket.emitMessage(event("result-generated", { output: { type: "sentence-synthesis" } }));
    socket.emitMessage(audio.buffer.slice(384));
    socket.emitMessage(event("task-finished", { usage: { characters: 2 } }));
    controller.abort("late abort must not replace success");

    await expect(result).resolves.toEqual({ audio, contentType: "audio/mpeg", billedCharacters: 2 });
    expect(socket.listenerCount()).toBe(0);
    expect(socket.closed).toBe(1);
  });

  it.each([[401, "tts_unavailable", 503], [403, "tts_unavailable", 503], [429, "tts_unavailable", 503], [500, "tts_upstream_error", 502], [301, "tts_upstream_error", 502], [200, "tts_upstream_error", 502]])(
    "maps handshake status %i without exposing provider details", async (status, code, httpStatus) => {
      const socket = new SocketDouble();
      const provider = createQwenTtsProvider(config, API_KEY, { fetch: async () => response(socket, status), randomUUID: () => TASK_ID });
      const error = await provider.synthesize({ text: TEXT }, new AbortController().signal).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(QwenTtsError);
      expect(error).toMatchObject({ code, status: httpStatus });
      expect(JSON.stringify(error)).not.toContain("sentinel");
      expect(socket.closed).toBe(1);
      expect(socket.accepted).toBe(true);
    },
  );

  it("rejects a missing Upgrade socket and protocol errors without partial audio", async () => {
    const provider = createQwenTtsProvider(config, API_KEY, { fetch: async () => response(null), randomUUID: () => TASK_ID });
    await expect(provider.synthesize({ text: TEXT }, new AbortController().signal)).rejects.toMatchObject({ code: "tts_upstream_error", status: 502 });

    const socket = new SocketDouble();
    const streaming = createQwenTtsProvider(config, API_KEY, { fetch: async () => response(socket), randomUUID: () => TASK_ID });
    const result = streaming.synthesize({ text: TEXT }, new AbortController().signal);
    await tick();
    socket.emitMessage("{");
    await expect(result).rejects.toMatchObject({ code: "tts_upstream_error" });
    expect(socket.listenerCount()).toBe(0);
    expect(socket.closed).toBe(1);
  });

  it("preserves a pre-aborted reason and does not create a fetch or task", async () => {
    const controller = new AbortController();
    const reason = new DOMException("deadline sentinel", "TimeoutError");
    controller.abort(reason);
    let fetches = 0;
    const provider = createQwenTtsProvider(config, API_KEY, { fetch: async () => { fetches += 1; return response(new SocketDouble()); } });
    await expect(provider.synthesize({ text: TEXT }, controller.signal)).rejects.toBe(reason);
    expect(fetches).toBe(0);
  });

  it("rejects immediately on abort, best-effort cancels an open task, and closes a late Upgrade", async () => {
    const pending = deferred<QwenUpgradeResponse>();
    const socket = new SocketDouble();
    const controller = new AbortController();
    const provider = createQwenTtsProvider(config, API_KEY, { fetch: () => pending.promise, randomUUID: () => TASK_ID });
    const result = provider.synthesize({ text: TEXT }, controller.signal);
    const reason = new DOMException("deadline sentinel", "TimeoutError");
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    pending.resolve(response(socket));
    await tick();
    expect(socket.accepted).toBe(true);
    expect(socket.closed).toBe(1);
    expect(socket.sends).toEqual([]);
    expect(socket.listenerCount()).toBe(0);

    const openSocket = new SocketDouble();
    const openController = new AbortController();
    const openProvider = createQwenTtsProvider(config, API_KEY, { fetch: async () => response(openSocket), randomUUID: () => TASK_ID });
    const openResult = openProvider.synthesize({ text: TEXT }, openController.signal);
    await tick();
    openController.abort(reason);
    await expect(openResult).rejects.toBe(reason);
    expect(openSocket.sends.map((message) => JSON.parse(message).header.action)).toEqual(["run-task", "finish-task"]);
    expect(JSON.parse(openSocket.sends[1]!).payload.input).toEqual({ directive: "cancel" });
  });

  it("rejects close/error/setup/send failures once and accepts before setup cleanup", async () => {
    const socket = new SocketDouble();
    const controller = new AbortController();
    const provider = createQwenTtsProvider(config, API_KEY, { fetch: async () => response(socket), randomUUID: () => TASK_ID });
    const result = provider.synthesize({ text: TEXT }, controller.signal);
    await tick();
    socket.emitClose();
    await expect(result).rejects.toMatchObject({ code: "tts_upstream_error" });
    expect(socket.listenerCount()).toBe(0);

    const broken = new SocketDouble();
    broken.throwOn = "send";
    const brokenProvider = createQwenTtsProvider(config, API_KEY, { fetch: async () => response(broken), randomUUID: () => TASK_ID });
    await expect(brokenProvider.synthesize({ text: TEXT }, new AbortController().signal)).rejects.toMatchObject({ code: "tts_upstream_error" });
    expect(broken.closed).toBe(1);

    const listenerFailure = new SocketDouble();
    listenerFailure.throwOn = "listener";
    const setupProvider = createQwenTtsProvider(config, API_KEY, { fetch: async () => response(listenerFailure), randomUUID: () => TASK_ID });
    await expect(setupProvider.synthesize({ text: TEXT }, new AbortController().signal)).rejects.toMatchObject({ code: "tts_upstream_error" });
    expect(listenerFailure.accepted).toBe(true);
    expect(listenerFailure.closed).toBe(1);
  });

  it("isolates sockets and task IDs across concurrent syntheses", async () => {
    const first = new SocketDouble();
    const second = new SocketDouble();
    let index = 0;
    const ids = [TASK_ID, "3bf83b9a-baeb-4fda-8d9a-123456789abc"];
    const provider = createQwenTtsProvider(config, API_KEY, {
      fetch: async () => response([first, second][index++]!), randomUUID: () => ids.shift()!,
    });
    const firstController = new AbortController();
    const firstResult = provider.synthesize({ text: TEXT }, firstController.signal);
    const secondResult = provider.synthesize({ text: TEXT }, new AbortController().signal);
    await tick();
    firstController.abort("first only");
    await expect(firstResult).rejects.toBe("first only");
    expect(second.closed).toBe(0);
    second.emitError();
    await expect(secondResult).rejects.toMatchObject({ code: "tts_upstream_error" });
  });
});
