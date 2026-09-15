import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../index.ts";
import { createMp3Fixture } from "../lib/tts/fixtures/mp3.ts";
import { makeEnv, makeExecutionContext, makeRequest } from "../test-utils.ts";

class SocketDouble {
  binaryType = "blob";
  accepted = false;
  closed = 0;
  readonly sent: string[] = [];
  readonly listeners = {
    message: new Set<(event: { data: unknown }) => void>(),
    close: new Set<() => void>(),
    error: new Set<() => void>(),
  };

  accept() { this.accepted = true; }
  close() { this.closed += 1; }
  send(message: string) { this.sent.push(message); }
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
  emitMessage(data: unknown) {
    for (const listener of this.listeners.message) listener({ data });
  }
}

const PROFILES = [
  { id: "zh-a", name: "중국어 A", password: "pw-a", sheetId: "sheet-a", modes: ["m1"], contentType: "zh" },
  { id: "zh-b", name: "중국어 B", password: "pw-b", sheetId: "sheet-b", modes: ["m1"], contentType: "zh" },
  { id: "generic", name: "일반", password: "pw-g", sheetId: "sheet-g", modes: ["m1"], contentType: "generic" },
];

function ttsRequest(
  password = "pw-a",
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
) {
  const { headers = {}, body, ...rest } = init;
  const method = rest.method ?? "POST";
  return makeRequest("/api/tts", {
    Authorization: `Bearer ${password}`,
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  }, {
    ...rest,
    method,
    ...(method === "GET" || method === "HEAD" ? {} : { body: body ?? JSON.stringify({ text: "经济", pinyin: "jīngjì" }) }),
  });
}

function audioObject(audio: Uint8Array) {
  return {
    size: audio.byteLength,
    httpMetadata: { contentType: "audio/mpeg" },
    body: new Blob([audio]).stream(),
  };
}

function configuredEnv(bucket: { get: (...args: never[]) => unknown; put: (...args: never[]) => unknown }) {
  return makeEnv({
    PROFILES: JSON.stringify(PROFILES),
    TTS_ENABLED: "true",
    DASHSCOPE_API_KEY: "test-only-key",
    TTS_AUDIO: bucket,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/tts — 인증과 사전 검증", () => {
  it("미인증은 빈 401과 no-store로 끝나며 R2/provider를 호출하지 않는다", async () => {
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const bucket = { get: vi.fn(), put: vi.fn() };
    const res = await worker.fetch(makeRequest("/api/tts", { "Content-Type": "application/json" }, { method: "POST", body: "{}" }), configuredEnv(bucket));

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(bucket.get).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "pw-a", { TTS_ENABLED: "true" }, 405, "method_not_allowed"],
    ["POST", "pw-g", { TTS_ENABLED: "true" }, 403, "tts_not_allowed"],
    ["POST", "pw-a", { TTS_ENABLED: "false" }, 503, "tts_disabled"],
    ["POST", "pw-a", { TTS_ENABLED: "true", DASHSCOPE_API_KEY: undefined }, 503, "tts_not_configured"],
  ])("인증·방법·프로필·설정 검증은 서비스 전에 끝난다", async (method, password, overrides, status, code) => {
    const bucket = { get: vi.fn(), put: vi.fn() };
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const request = ttsRequest(password, { method });
    const env = makeEnv({ PROFILES: JSON.stringify(PROFILES), TTS_AUDIO: bucket, DASHSCOPE_API_KEY: "test-only-key", ...overrides });
    const res = await worker.fetch(request, env);

    expect(res.status).toBe(status);
    expect((await res.json()) as object).toMatchObject({ error: code });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(bucket.get).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    [{ headers: { "Content-Type": "text/plain" } }, 415, "unsupported_media_type"],
    [{ body: "{broken" }, 400, "invalid_tts_request"],
    [{ body: JSON.stringify({ text: "经济", profileId: "zh-b" }) }, 400, "invalid_tts_request"],
  ])("잘못된 media/body는 %i %s로 R2/provider 전에 종료된다", async (init, status, code) => {
    const bucket = { get: vi.fn(), put: vi.fn() };
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const res = await worker.fetch(ttsRequest("pw-a", init), configuredEnv(bucket));

    expect(res.status).toBe(status);
    expect((await res.json()) as object).toMatchObject({ error: code });
    expect(bucket.get).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("POST /api/tts — 서비스 결과 직렬화", () => {
  it("R2 hit의 정확한 MP3 바이트와 진단 헤더를 반환하고 provider를 호출하지 않는다", async () => {
    const audio = createMp3Fixture(2);
    const bucket = { get: vi.fn().mockResolvedValue(audioObject(audio)), put: vi.fn() };
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);

    const res = await worker.fetch(ttsRequest(), configuredEnv(bucket));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(audio);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-TTS-Source")).toBe("STORED");
    expect(res.headers.get("X-TTS-Storage")).toBe("PRESENT");
    expect(res.headers.get("X-TTS-Pronunciation")).toBe("ignored");
    expect(res.headers.get("X-TTS-Revision")).toBe("tts-v1");
    expect(bucket.put).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("provider 인증 실패를 앱 인증 401이 아닌 공개 503으로 변환한다", async () => {
    const bucket = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401, webSocket: null })));
    const res = await worker.fetch(ttsRequest(), configuredEnv(bucket));

    expect(res.status).toBe(503);
    expect((await res.json()) as object).toEqual({ error: "tts_unavailable", message: "발음을 불러올 수 없습니다." });
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
    expect(res.headers.get("X-TTS-Source")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("예상 못 한 내부 예외는 비밀을 노출하지 않는 500으로 고정한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("private sentinel"); });
    const bucket = { get: vi.fn(), put: vi.fn() };
    const res = await worker.fetch(ttsRequest(), configuredEnv(bucket));

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("tts_unavailable");
    expect(text).not.toContain("private sentinel");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("프로필별 R2 키를 분리하며 TTS 경로에서 Sheets 호출을 추가하지 않는다", async () => {
    const audio = createMp3Fixture();
    const keys: string[] = [];
    const bucket = {
      get: vi.fn(async (key: string) => { keys.push(key); return audioObject(audio); }),
      put: vi.fn(),
    };
    const external = vi.fn();
    vi.stubGlobal("fetch", external);
    const env = configuredEnv(bucket);

    const [a, b] = await Promise.all([worker.fetch(ttsRequest("pw-a"), env), worker.fetch(ttsRequest("pw-b"), env)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(external).not.toHaveBeenCalled();
  });

  it("취소된 요청은 서비스·R2·provider를 시작하지 않고 원래 reason을 유지한다", async () => {
    const bucket = { get: vi.fn(), put: vi.fn() };
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);
    const request = ttsRequest("pw-a", { signal: controller.signal });

    await expect(worker.fetch(request, configuredEnv(bucket), makeExecutionContext())).rejects.toBe(reason);
    expect(bucket.get).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("실제 service가 외부 Upgrade/R2 더블과 ctx.waitUntil을 연결하고 생성·저장 결과를 반환한다", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const socket = new SocketDouble();
    const audio = createMp3Fixture(2);
    const bucket = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue({ etag: "saved" }) };
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 101, webSocket: socket })));
    const ctx = makeExecutionContext();
    const pending = worker.fetch(ttsRequest(), configuredEnv(bucket), ctx);

    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    const taskId = JSON.parse(socket.sent[0]!).header.task_id as string;
    const event = (name: string, payload: Record<string, unknown> = {}) => JSON.stringify({ header: { task_id: taskId, event: name }, payload });
    socket.emitMessage(event("task-started"));
    socket.emitMessage(event("result-generated", { output: { type: "sentence-synthesis" } }));
    socket.emitMessage(audio.buffer.slice(0, 384));
    socket.emitMessage(event("result-generated", { output: { type: "sentence-synthesis" } }));
    socket.emitMessage(audio.buffer.slice(384));
    socket.emitMessage(event("task-finished", { usage: { characters: 2 } }));

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.headers.get("X-TTS-Source")).toBe("GENERATED");
    expect(res.headers.get("X-TTS-Storage")).toBe("SAVED");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(audio);
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(ctx.tasks).toHaveLength(1);
    await expect(ctx.drain()).resolves.toBeUndefined();
  });

  it("진행 중 취소를 실제 Qwen adapter에 전달해 socket을 닫고 원래 reason을 보존한다", async () => {
    const socket = new SocketDouble();
    const bucket = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 101, webSocket: socket })));
    const controller = new AbortController();
    const reason = new DOMException("caller cancelled", "AbortError");
    const pending = worker.fetch(ttsRequest("pw-a", { signal: controller.signal }), configuredEnv(bucket), makeExecutionContext());

    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(socket.closed).toBe(1);
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
