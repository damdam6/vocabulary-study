import { afterEach, describe, expect, it, vi } from "vitest";

// 실제 RSA 서명 없이 라우트를 테스트하기 위해 토큰 발급 자체를 모킹한다 —
// sheets.ts가 이 모듈의 getAccessToken을 그대로 가져다 쓴다.
vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { makeEnv, makeRequest } from "../test-utils.ts";
import { DEFAULT_SESSION_LIMIT, SESSION_LIMIT_KEY, SETTINGS_TAB } from "../lib/settings.ts";

// GET /api/words 응답의 settings 블록 (#102, 플랜 §3.2) — 시트 설정을 클라이언트로 전파하는 경로.
// 함께 검증하는 회귀: '_정보' 탭은 기존 `_` 접두 규칙만으로 출제 목록·탭 목록에서 빠진다.
// isolate 수명 동안 프로필 구성이 고정되므로 이 파일은 단일 프로필 구성만 쓴다.
const env = makeEnv({
  PROFILES: JSON.stringify([
    {
      id: "zh",
      name: "중국어 단어",
      password: "pw-zh",
      sheetId: "sheet-zh",
      modes: ["m1", "m2"],
      contentType: "zh",
    },
  ]),
});

const WORD_ROWS = [["经济", "jīngjì", "경제", "1", "2", "2026-07-30|3"]];

interface WordsBody {
  words: { tab: string }[];
  profile: unknown;
  settings: { sessionLimit: number };
}

/**
 * Sheets API를 가로채 탭 목록·범위 읽기에 응답한다.
 * `settingsRows`가 undefined면 '_정보' 탭이 없는 시트 — 실제 API처럼 400으로 답한다.
 */
function stubSheets(options: {
  titles: string[];
  rows?: Record<string, string[][]>;
  settingsRows?: string[][];
}): { urls: string[] } {
  const { titles, rows = { HSK6급: WORD_ROWS }, settingsRows } = options;
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = input.toString();
      urls.push(url);
      if (url.includes("?fields=")) {
        return Response.json({ sheets: titles.map((title) => ({ properties: { title } })) });
      }
      const decoded = decodeURIComponent(url.split("/values/")[1].split("?")[0]);
      const tab = decoded.slice(1, decoded.indexOf("!") - 1);
      if (tab === SETTINGS_TAB) {
        return settingsRows
          ? Response.json({ values: settingsRows })
          : new Response("Unable to parse range", { status: 400 });
      }
      return Response.json({ values: rows[tab] ?? [] });
    }),
  );
  return { urls };
}

async function getWords(): Promise<{ res: Response; body: WordsBody }> {
  const res = await worker.fetch(makeRequest("/api/words", { Authorization: "Bearer pw-zh" }), env);
  return { res, body: (await res.json()) as WordsBody };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/words — settings 동봉", () => {
  it("'_정보' 탭의 문제수를 sessionLimit으로 실어 보낸다", async () => {
    stubSheets({ titles: ["HSK6급", SETTINGS_TAB], settingsRows: [[SESSION_LIMIT_KEY, "30"]] });
    const { res, body } = await getWords();
    expect(res.status).toBe(200);
    expect(body.settings).toEqual({ sessionLimit: 30 });
  });

  it("'_정보' 탭이 없으면 기본 60을 싣는다", async () => {
    stubSheets({ titles: ["HSK6급"] });
    const { res, body } = await getWords();
    expect(res.status).toBe(200);
    expect(body.settings).toEqual({ sessionLimit: DEFAULT_SESSION_LIMIT });
  });

  it("설정 값이 이상해도(범위 밖) 기본 60으로 폴백한다", async () => {
    stubSheets({ titles: ["HSK6급", SETTINGS_TAB], settingsRows: [[SESSION_LIMIT_KEY, "501"]] });
    const { body } = await getWords();
    expect(body.settings).toEqual({ sessionLimit: DEFAULT_SESSION_LIMIT });
  });

  it("설정 읽기가 500으로 실패해도 words는 200으로 응답한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url.includes("?fields=")) {
          return Response.json({ sheets: [{ properties: { title: "HSK6급" } }] });
        }
        const decoded = decodeURIComponent(url.split("/values/")[1].split("?")[0]);
        if (decoded.includes(SETTINGS_TAB)) {
          return new Response("boom", { status: 500 });
        }
        return Response.json({ values: WORD_ROWS });
      }),
    );

    const { res, body } = await getWords();
    expect(res.status).toBe(200);
    expect(body.settings).toEqual({ sessionLimit: DEFAULT_SESSION_LIMIT });
    expect(body.words).toHaveLength(1);
  });

  it("'_정보' 읽기도 인증된 프로필의 sheetId로만 나간다", async () => {
    const { urls } = stubSheets({
      titles: ["HSK6급", SETTINGS_TAB],
      settingsRows: [[SESSION_LIMIT_KEY, "30"]],
    });
    await getWords();
    expect(urls.some((url) => decodeURIComponent(url).includes(SETTINGS_TAB))).toBe(true);
    for (const url of urls) {
      expect(url).toContain("/spreadsheets/sheet-zh");
    }
  });
});

describe("GET /api/words — '_정보' 탭은 학습에서 자연 제외된다 (기존 `_` 규칙 회귀)", () => {
  it("설정 탭의 행이 출제 목록에 섞이지 않는다", async () => {
    stubSheets({
      titles: ["HSK6급", SETTINGS_TAB],
      settingsRows: [[SESSION_LIMIT_KEY, "30"]],
      rows: { HSK6급: WORD_ROWS },
    });
    const { body } = await getWords();
    expect(body.words.map((word) => word.tab)).toEqual(["HSK6급"]);
  });

  it("GET /api/tabs 목록에도 나타나지 않는다", async () => {
    stubSheets({ titles: ["HSK6급", SETTINGS_TAB], settingsRows: [[SESSION_LIMIT_KEY, "30"]] });
    const res = await worker.fetch(
      makeRequest("/api/tabs", { Authorization: "Bearer pw-zh" }),
      env,
    );
    expect((await res.json()) as object).toEqual({ tabs: ["HSK6급"] });
  });
});
