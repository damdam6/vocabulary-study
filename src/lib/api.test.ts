import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  clearPassword,
  getStoredPassword,
  savePassword,
  setUnauthorizedHandler,
  verifyPassword,
} from "./api";

// vitest는 node 환경이라 localStorage/fetch가 없다 — 전역에 스텁을 주입한다.
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe("저장소 헬퍼", () => {
  it("저장 → 조회 → 삭제가 왕복한다", () => {
    expect(getStoredPassword()).toBeNull();
    savePassword("secret");
    expect(getStoredPassword()).toBe("secret");
    clearPassword();
    expect(getStoredPassword()).toBeNull();
  });
});

describe("apiFetch", () => {
  it("저장된 비밀번호를 Authorization: Bearer 헤더로 첨부한다", async () => {
    savePassword("secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/words");

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/words");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
  });

  it("호출부가 넘긴 헤더를 보존하면서 Authorization을 추가한다", async () => {
    savePassword("secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer secret");
    expect(init.method).toBe("POST");
  });

  it("저장된 비밀번호가 없으면 Authorization 없이 호출한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/words");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("401 수신 시 저장값을 지우고 unauthorized 핸들러를 호출한 뒤 응답을 반환한다", async () => {
    savePassword("stale");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    const response = await apiFetch("/api/words");

    expect(response.status).toBe(401);
    expect(getStoredPassword()).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("200 응답이면 저장값과 핸들러를 건드리지 않는다", async () => {
    savePassword("secret");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    await apiFetch("/api/words");

    expect(getStoredPassword()).toBe("secret");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("verifyPassword", () => {
  it("200이면 'ok' — 후보 값을 Bearer로 /api/health에 보낸다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyPassword("candidate")).resolves.toBe("ok");

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/health");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer candidate");
  });

  it("401이면 'invalid'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(verifyPassword("wrong")).resolves.toBe("invalid");
  });

  it("500 등 그 외 상태면 'error'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(verifyPassword("any")).resolves.toBe("error");
  });

  it("네트워크 예외면 'error'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(verifyPassword("any")).resolves.toBe("error");
  });
});
