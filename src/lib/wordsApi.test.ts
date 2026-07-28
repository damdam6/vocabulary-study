import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicProfile, WordEntry } from "./api";
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

const PROFILE: PublicProfile = {
  id: "zh",
  name: "중국어 단어",
  modes: ["m1", "m2"],
  contentType: "zh",
};

describe("fetchWords", () => {
  it("GET /api/words를 apiFetch 경유(Authorization 첨부)로 호출하고 {profile, words, settings}를 반환한다", async () => {
    localStorage.setItem("app-password", "secret");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        fetchedAt: "2026-07-18 09:00",
        words: [WORD],
        profile: PROFILE,
        settings: { sessionLimit: 30 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWords()).resolves.toEqual({
      words: [WORD],
      profile: PROFILE,
      settings: { sessionLimit: 30 },
    });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/words");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
  });

  it("AbortSignal을 fetch에 전달한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ words: [], profile: PROFILE }));
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

  describe("settings 폴백 (세션 설정 플랜 §3.2, #104) — 구서버 호환·방어", () => {
    it("settings가 아예 없으면 sessionLimit 60으로 폴백한다", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ words: [], profile: PROFILE })));

      await expect(fetchWords()).resolves.toEqual({ words: [], profile: PROFILE, settings: { sessionLimit: 60 } });
    });

    it.each([
      ["null", null],
      ["배열", []],
      ["문자열", "30"],
      ["sessionLimit 없음", {}],
      ["sessionLimit이 문자열", { sessionLimit: "30" }],
      ["sessionLimit이 소수", { sessionLimit: 30.5 }],
      ["sessionLimit이 0", { sessionLimit: 0 }],
      ["sessionLimit이 음수", { sessionLimit: -5 }],
    ])("settings 형태 이상(%s)이면 sessionLimit 60으로 폴백한다", async (_label, settings) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ words: [], profile: PROFILE, settings })),
      );

      const result = await fetchWords();

      expect(result.settings).toEqual({ sessionLimit: 60 });
    });

    it("settings.sessionLimit이 유효한 양의 정수면 그대로 쓴다", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({ words: [], profile: PROFILE, settings: { sessionLimit: 1 } }),
        ),
      );

      const result = await fetchWords();

      expect(result.settings).toEqual({ sessionLimit: 1 });
    });
  });
});
