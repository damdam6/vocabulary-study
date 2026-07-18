import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WordEntry } from "./api";
import { fetchWords } from "./wordsApi";

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

const WORD: WordEntry = {
  tab: "HSK4",
  hanzi: "经济",
  pinyin: "jīngjì",
  meaning: "경제",
  m1: 3,
  m2: 3,
  nextReview: "2026-07-20",
  interval: 7,
};

describe("fetchWords", () => {
  it("GET /api/words를 apiFetch 경유(Authorization 첨부)로 호출하고 words 배열을 반환한다", async () => {
    localStorage.setItem("app-password", "secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ fetchedAt: "2026-07-18 09:00", words: [WORD] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWords()).resolves.toEqual([WORD]);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/words");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
  });

  it("AbortSignal을 fetch에 전달한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ words: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchWords(controller.signal);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("비정상 응답이면 throw한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(fetchWords()).rejects.toThrow("500");
  });
});
