import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.ts";
import { createMp3Fixture } from "./lib/tts/fixtures/mp3.ts";
import { makeEnv, makeExecutionContext, makeRequest } from "./test-utils.ts";

const profiles = JSON.stringify([
  { id: "zh", name: "중국어", password: "test-password", sheetId: "sheet-zh", modes: ["m1", "m2"], contentType: "zh" },
]);

class SocketDouble {
  binaryType = "blob";
  accepted = false;
  closed = 0;
  sent: string[] = [];
  private readonly listeners = new Set<(event: { data: unknown }) => void>();

  accept() { this.accepted = true; }
  close() { this.closed += 1; }
  send(message: string) { this.sent.push(message); }
  // Qwen의 close/error listener는 이 정상 흐름 fixture에서 발생시키지 않는다.
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(_type: "close" | "error", _listener: () => void): void;
  addEventListener(type: "message" | "close" | "error", listener: ((event: { data: unknown }) => void) | (() => void)) {
    if (type === "message") this.listeners.add(listener as (event: { data: unknown }) => void);
  }
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(_type: "close" | "error", _listener: () => void): void;
  removeEventListener(type: "message" | "close" | "error", listener: ((event: { data: unknown }) => void) | (() => void)) {
    if (type === "message") this.listeners.delete(listener as (event: { data: unknown }) => void);
  }
  emit(data: unknown) { for (const listener of this.listeners) listener({ data }); }
}

class StatefulBucket {
  readonly bytes = new Map<string, Uint8Array>();
  readonly gets = vi.fn(async (key: string) => {
    const value = this.bytes.get(key);
    if (!value) return null;
    // R2 get처럼 매번 새 stream을 만든다. 이전 읽기가 다음 세션의 결과를 만들지 않는다.
    const copy = value.slice();
    return { size: copy.byteLength, httpMetadata: { contentType: "audio/mpeg" }, body: new Blob([copy]).stream() };
  });
  readonly puts = vi.fn(async (key: string, value: ArrayBufferView, options: { onlyIf: Headers }) => {
    expect(options.onlyIf.get("If-None-Match")).toBe("*");
    if (this.bytes.has(key)) return null;
    this.bytes.set(key, new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
    return { etag: "saved" };
  });
  get = this.gets;
  put = this.puts;
}

function env(bucket: StatefulBucket) {
  return makeEnv({
    PROFILES: profiles,
    TTS_ENABLED: "true",
    DASHSCOPE_API_KEY: "test-only-key",
    TTS_AUDIO: bucket,
  });
}

function request(password = "test-password") {
  return makeRequest("/api/tts", {
    Authorization: `Bearer ${password}`,
    "Content-Type": "application/json",
  }, { method: "POST", body: JSON.stringify({ text: "经济", pinyin: "jīngjì" }) });
}

async function finish(socket: SocketDouble, audio: Uint8Array) {
  await vi.waitFor(() => expect(socket.accepted).toBe(true));
  const taskId = JSON.parse(socket.sent[0]!).header.task_id as string;
  const event = (name: string, payload: Record<string, unknown> = {}) =>
    JSON.stringify({ header: { task_id: taskId, event: name }, payload });
  socket.emit(event("task-started"));
  socket.emit(event("result-generated", { output: { type: "sentence-synthesis" } }));
  socket.emit(audio.buffer.slice(0, Math.floor(audio.byteLength / 2)));
  socket.emit(event("result-generated", { output: { type: "sentence-synthesis" } }));
  socket.emit(audio.buffer.slice(Math.floor(audio.byteLength / 2)));
  socket.emit(event("task-finished", { usage: { characters: 2 } }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("중국어 TTS 대표 Worker 통합 흐름 (#150)", () => {
  it("S1: 실제 route/service/R2/Qwen 연결이 저장한 바이트를 새 요청에서 provider 없이 재사용한다", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const bucket = new StatefulBucket();
    const firstSocket = new SocketDouble();
    const provider = vi.fn().mockResolvedValueOnce({ status: 101, webSocket: firstSocket });
    vi.stubGlobal("fetch", provider);
    const firstContext = makeExecutionContext();
    const audio = createMp3Fixture(2);

    const first = worker.fetch(request(), env(bucket), firstContext);
    await finish(firstSocket, audio);
    const firstResponse = await first;
    expect(firstResponse.headers.get("X-TTS-Source")).toBe("GENERATED");
    expect(firstResponse.headers.get("X-TTS-Storage")).toBe("SAVED");
    expect(new Uint8Array(await firstResponse.arrayBuffer())).toEqual(audio);
    await firstContext.drain();
    expect(bucket.puts).toHaveBeenCalledTimes(1);

    // 새 request/context는 controller/cache가 없는 후속 세션에 해당하며 bucket만 공유한다.
    provider.mockRejectedValueOnce(new Error("stored audio must not need Qwen"));
    const secondContext = makeExecutionContext();
    const second = await worker.fetch(request(), env(bucket), secondContext);
    expect(second.headers.get("X-TTS-Source")).toBe("STORED");
    expect(second.headers.get("X-TTS-Storage")).toBe("PRESENT");
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(audio);
    expect(bucket.gets).toHaveBeenCalledTimes(2);
    expect(bucket.puts).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    await secondContext.drain();
  });

  it("S2/S3: 조회 장애는 합성하지 않고, 쓰기 장애는 생성 MP3를 UNCONFIRMED로 반환한다", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const unavailable = new StatefulBucket();
    unavailable.get = vi.fn().mockRejectedValue(new Error("R2 unavailable"));
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const failedRead = await worker.fetch(request(), env(unavailable));
    expect(failedRead.status).toBe(503);
    await expect(failedRead.json()).resolves.toMatchObject({ error: "tts_storage_unavailable" });
    expect(provider).not.toHaveBeenCalled();

    const writeFailure = new StatefulBucket();
    writeFailure.put = vi.fn().mockRejectedValue(new Error("R2 write unavailable"));
    const socket = new SocketDouble();
    provider.mockResolvedValueOnce({ status: 101, webSocket: socket });
    const context = makeExecutionContext();
    const pending = worker.fetch(request(), env(writeFailure), context);
    await finish(socket, createMp3Fixture(2));
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("X-TTS-Source")).toBe("GENERATED");
    expect(response.headers.get("X-TTS-Storage")).toBe("UNCONFIRMED");
    await context.drain();
  });

  it("S4: provider 인증 실패는 앱 인증 401과 분리되고, 앱 401은 R2/provider 전에 종료된다", async () => {
    const bucket = new StatefulBucket();
    const provider = vi.fn().mockResolvedValue({ status: 401, webSocket: null });
    vi.stubGlobal("fetch", provider);
    const providerFailure = await worker.fetch(request(), env(bucket));
    expect(providerFailure.status).toBe(503);
    expect(providerFailure.headers.get("WWW-Authenticate")).toBeNull();
    expect(bucket.puts).not.toHaveBeenCalled();

    const appFailure = await worker.fetch(request("wrong-password"), env(bucket));
    expect(appFailure.status).toBe(401);
    expect(bucket.gets).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
