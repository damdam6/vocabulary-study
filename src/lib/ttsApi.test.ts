import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePassword, setApiSuccessHandler, setUnauthorizedHandler } from "./api";
import { fetchTtsAudio } from "./ttsApi";
import { TTS_ERROR_CODES } from "./ttsTypes";

const MAX_BYTES = 4 * 1024 * 1024;

function headers(overrides: Record<string, string> = {}) {
  return {
    "Content-Type": "audio/mpeg",
    "X-TTS-Source": "GENERATED",
    "X-TTS-Storage": "SAVED",
    "X-TTS-Pronunciation": "absent",
    "X-TTS-Revision": "r1",
    ...overrides,
  };
}

function audioResponse(body: BodyInit | null = new Uint8Array([1, 2, 3]), overrides = {}) {
  return new Response(body, { status: 200, headers: headers(overrides) });
}

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

beforeEach(() => vi.stubGlobal("localStorage", storage()));
afterEach(() => {
  setApiSuccessHandler(null);
  setUnauthorizedHandler(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchTtsAudio", () => {
  it("apiFetch로 인증된 POST를 한 번 보내며 text/pinyin 외 필드를 제거한다", async () => {
    savePassword("secret");
    const success = vi.fn();
    setApiSuccessHandler(success);
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal("fetch", fetchMock);

    await fetchTtsAudio({ text: "你好", pinyin: "nǐ hǎo", provider: "no" } as never, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/tts");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(init.body))).toEqual({ text: "你好", pinyin: "nǐ hǎo" });
    expect(success).toHaveBeenCalledOnce();
  });

  it("pinyin이 정의되지 않으면 요청에서 생략한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    await fetchTtsAudio({ text: "你好" }, new AbortController().signal);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ text: "你好" });
  });

  it.each([
    ["STORED", "PRESENT"],
    ["GENERATED", "SAVED"],
    ["GENERATED", "UNCONFIRMED"],
  ])("%s/%s 진단과 MP3 Blob을 반환한다", async (source, storageValue) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(audioResponse(new Uint8Array([7]), {
      "X-TTS-Source": source,
      "X-TTS-Storage": storageValue,
      "X-TTS-Pronunciation": "ignored",
    })));
    const result = await fetchTtsAudio({ text: "字" }, new AbortController().signal);
    expect(result).toMatchObject({ source, storage: storageValue, pronunciation: "ignored", revision: "r1" });
    expect(result).not.toHaveProperty("billedCharacters");
    expect(result.audio.type).toBe("audio/mpeg");
    expect([...new Uint8Array(await result.audio.arrayBuffer())]).toEqual([7]);
  });

  it.each([
    { "Content-Type": "application/json" },
    { "X-TTS-Revision": "" },
    { "X-TTS-Source": "STORED", "X-TTS-Storage": "SAVED" },
    { "X-TTS-Pronunciation": "forced" },
  ])("잘못된 성공 헤더를 거부한다: %o", async (override) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(audioResponse(new Uint8Array([1]), override)));
    await expect(fetchTtsAudio({ text: "字" }, new AbortController().signal)).rejects.toEqual({ kind: "invalid_response" });
  });

  it("빈 바디와 실제 4MiB 초과를 거부하고 정확한 경계는 허용한다", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(audioResponse(new Uint8Array()))
      .mockResolvedValueOnce(audioResponse(new Uint8Array(MAX_BYTES)))
      .mockResolvedValueOnce(audioResponse(new Uint8Array(MAX_BYTES + 1)));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await expect(fetchTtsAudio({ text: "a" }, signal)).rejects.toEqual({ kind: "invalid_response" });
    await expect(fetchTtsAudio({ text: "b" }, signal)).resolves.toMatchObject({ source: "GENERATED" });
    await expect(fetchTtsAudio({ text: "c" }, signal)).rejects.toEqual({ kind: "invalid_response" });
  });

  it("거짓으로 작은 Content-Length는 실제 바이트로 검사하고 과대 헤더는 조기 거부한다", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream({ cancel: cancelled });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(audioResponse(new Uint8Array(MAX_BYTES + 1), { "Content-Length": "1" }))
      .mockResolvedValueOnce(audioResponse(stream, { "Content-Length": String(MAX_BYTES + 1) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTtsAudio({ text: "a" }, new AbortController().signal)).rejects.toEqual({ kind: "invalid_response" });
    await expect(fetchTtsAudio({ text: "b" }, new AbortController().signal)).rejects.toEqual({ kind: "invalid_response" });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each(TTS_ERROR_CODES)("공개 HTTP 오류 %s를 보존한다", async (error) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error, message: "공개 메시지" }, { status: 503 })));
    await expect(fetchTtsAudio({ text: "字" }, new AbortController().signal)).rejects.toEqual({
      kind: "http", status: 503, error, message: "공개 메시지",
    });
  });

  it.each(["not json", JSON.stringify({ error: "unknown", message: "x" }), ""])("깨진 오류 본문을 invalid_response로 만든다", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 500 })));
    await expect(fetchTtsAudio({ text: "字" }, new AbortController().signal)).rejects.toEqual({ kind: "invalid_response" });
  });

  it("빈 401에서도 apiFetch의 인증 정리를 유지한다", async () => {
    savePassword("stale");
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(fetchTtsAudio({ text: "字" }, new AbortController().signal)).rejects.toEqual({ kind: "invalid_response" });
    expect(localStorage.getItem("app-password")).toBeNull();
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it("fetch 네트워크 실패를 network로 만들고 재시도하지 않는다", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTtsAudio({ text: "字" }, new AbortController().signal)).rejects.toEqual({ kind: "network" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("이미 취소된 신호는 fetch 전에 aborted로 끝난다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchTtsAudio({ text: "字" }, controller.signal)).rejects.toEqual({ kind: "aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["fetch", "body"])("%s 대기 중 외부 취소를 적용한다", async (phase) => {
    const never = new Promise<Response>(() => undefined);
    const response = audioResponse(new ReadableStream({ pull: () => new Promise(() => undefined) }));
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(phase === "fetch" ? never : Promise.resolve(response)));
    const controller = new AbortController();
    const pending = fetchTtsAudio({ text: "字" }, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toEqual({ kind: "aborted" });
  });

  it.each(["fetch", "body"])("%s 대기 중 20초 timeout을 적용한다", async (phase) => {
    vi.useFakeTimers();
    const never = new Promise<Response>(() => undefined);
    const response = audioResponse(new ReadableStream({ pull: () => new Promise(() => undefined) }));
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(phase === "fetch" ? never : Promise.resolve(response)));
    const pending = fetchTtsAudio({ text: "字" }, new AbortController().signal);
    const assertion = expect(pending).rejects.toEqual({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
