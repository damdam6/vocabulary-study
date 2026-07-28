import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTab, fetchTabs, registerWords } from "./registerApi";

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
  vi.unstubAllGlobals();
});

describe("fetchTabs", () => {
  it("GET /api/tabs를 apiFetch 경유(Authorization 첨부)로 호출하고 tabs 배열을 반환한다", async () => {
    localStorage.setItem("app-password", "secret");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ tabs: ["HSK4", "HSK6"] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTabs()).resolves.toEqual(["HSK4", "HSK6"]);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/tabs");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
  });

  it("AbortSignal을 fetch에 전달한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ tabs: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchTabs(controller.signal);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("비정상 응답이고 본문이 JSON이 아니면 HTTP 상태를 담은 메시지로 throw한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(fetchTabs()).rejects.toThrow("500");
  });

  it("비정상 응답의 {error} 본문이 있으면 그 메시지로 throw한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "failed to load tabs" }, { status: 500 })),
    );
    await expect(fetchTabs()).rejects.toThrow("failed to load tabs");
  });
});

describe("registerWords", () => {
  it("/api/words/register에 JSON 바디를 POST하고 결과(worker/routes/register.ts 실측 응답 형태)를 반환한다", async () => {
    savePassword();
    const responseBody = {
      tab: "HSK4",
      created: false,
      added: [{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }],
      skipped: ["你好"],
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(responseBody));
    vi.stubGlobal("fetch", fetchMock);

    const request = {
      tab: "HSK4",
      words: [{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }],
    };
    await expect(registerWords(request)).resolves.toEqual(responseBody);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/words/register");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it("비정상 응답이고 본문이 JSON이 아니면 HTTP 상태를 담은 메시지로 throw한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    await expect(registerWords({ tab: "HSK4", words: [] })).rejects.toThrow("400");
  });

  it("비정상 응답의 {error} 본문이 있으면 Worker가 준 구체적 사유로 throw한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "존재하지 않는 탭입니다. 새로 만들려면 createTab을 지정하세요" }, { status: 400 })),
    );
    await expect(registerWords({ tab: "새탭", words: [] })).rejects.toThrow(
      "존재하지 않는 탭입니다. 새로 만들려면 createTab을 지정하세요",
    );
  });
});

describe("createTab", () => {
  it("/api/tabs에 { name } 바디를 POST하고 결과(worker/routes/tabs.ts 실측 응답 형태)를 반환한다", async () => {
    savePassword();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ name: "HSK7", created: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTab("HSK7")).resolves.toEqual({ name: "HSK7", created: true });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/tabs");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).toEqual({ name: "HSK7" });
  });

  it("기존 탭 이름이면 created: false 멱등 응답을 그대로 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ name: "HSK6급", created: false })));
    await expect(createTab("  HSK6급  ")).resolves.toEqual({ name: "HSK6급", created: false });
  });

  it("비정상 응답이고 본문이 JSON이 아니면 HTTP 상태를 담은 메시지로 throw한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(createTab("HSK7")).rejects.toThrow("500");
  });

  it("비정상 응답의 {error} 본문이 있으면 Worker가 준 구체적 사유로 throw한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "탭 이름은 _로 시작할 수 없습니다" }, { status: 400 })),
    );
    await expect(createTab("_숨김")).rejects.toThrow("탭 이름은 _로 시작할 수 없습니다");
  });
});

function savePassword() {
  localStorage.setItem("app-password", "secret");
}
