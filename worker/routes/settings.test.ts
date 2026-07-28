import { afterEach, describe, expect, it, vi } from "vitest";

// 실제 RSA 서명 없이 라우트를 테스트하기 위해 토큰 발급 자체를 모킹한다 —
// sheets.ts가 이 모듈의 getAccessToken을 그대로 가져다 쓴다.
vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { makeEnv, makeRequest } from "../test-utils.ts";

// getProfiles·다이제스트 캐시가 isolate 수명 동안 첫 성공 구성을 고정하므로 이 파일의
// 모든 테스트가 같은 PROFILES 값을 쓴다 (index.sheet-isolation.test.ts와 같은 규약).
// 시트 격리 검증을 위해 2프로필 구성 — 주 경로는 zh, 격리 테스트는 en으로 호출한다.
const PROFILES = [
  {
    id: "zh",
    name: "중국어 단어",
    password: "pw-zh",
    sheetId: "sheet-zh",
    modes: ["m1", "m2"],
    contentType: "zh",
  },
  {
    id: "en",
    name: "영어 표현",
    password: "pw-en",
    sheetId: "sheet-en",
    modes: ["m1"],
    contentType: "generic",
  },
];

const env = makeEnv({ PROFILES: JSON.stringify(PROFILES) });

type WorkerRequest = Parameters<typeof worker.fetch>[0];

interface SheetState {
  titles: string[];
  rows: Record<string, string[][]>;
}

interface PutCall {
  sheetId: string;
  tab: string;
  range: string;
  values: (string | number)[][];
}

// Google Sheets API v4 호출을 가로채 sheetId별 메모리 상태로 흉내 낸다.
// settings.ts가 쓰는 요청(탭 제목 조회·addSheet·A1:B 읽기·단일 range PUT)과
// 회귀 확인용 words/tabs 요청(A2:F 읽기)만 지원한다. 호출 URL 전부를 기록해
// sheetId 격리·valueInputOption 검증에 쓴다.
function stubSheetsFetch(sheets: Record<string, SheetState>): { urls: string[]; putCalls: PutCall[] } {
  const urls: string[] = [];
  const putCalls: PutCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      urls.push(url);

      const sheetId = url.match(/\/spreadsheets\/([^/?:]+)/)?.[1] ?? "";
      const sheet = sheets[sheetId];
      if (!sheet) {
        return new Response("sheet not found", { status: 404 });
      }

      if (method === "GET" && url.includes("?fields=")) {
        return Response.json({ sheets: sheet.titles.map((title) => ({ properties: { title } })) });
      }

      if (url.includes(":batchUpdate") && !url.includes("/values:batchUpdate")) {
        const body = JSON.parse(init?.body as string) as {
          requests: { addSheet?: { properties: { title: string } } }[];
        };
        for (const req of body.requests) {
          if (req.addSheet) {
            sheet.titles.push(req.addSheet.properties.title);
            sheet.rows[req.addSheet.properties.title] = [];
          }
        }
        return Response.json({});
      }

      const { tab, range } = parseTabRange(url);
      // 실제 API처럼 존재하지 않는 탭 조회는 400 — titles 확인 없이 읽는 회귀를 잡는다.
      if (!sheet.titles.includes(tab)) {
        return new Response("Unable to parse range", { status: 400 });
      }

      if (method === "GET") {
        return Response.json({ values: sliceRange(sheet.rows[tab] ?? [], range) });
      }

      if (method === "PUT") {
        const values = (JSON.parse(init?.body as string) as { values: (string | number)[][] }).values;
        putCalls.push({ sheetId, tab, range, values });
        writeRange(sheet.rows, tab, range, values);
        return Response.json({ updatedRange: range });
      }

      throw new Error(`unhandled mock request: ${method} ${url}`);
    }),
  );

  return { urls, putCalls };
}

function parseTabRange(url: string): { tab: string; range: string } {
  const afterValues = url.split("/values/")[1];
  const decoded = decodeURIComponent(afterValues.split("?")[0]);
  const bang = decoded.indexOf("!");
  return { tab: decoded.slice(1, bang - 1), range: decoded.slice(bang + 1) };
}

function sliceRange(rows: string[][], range: string): string[][] {
  if (range === "A1:B") {
    return rows;
  }
  if (range === "A2:F") {
    return rows.slice(1);
  }
  throw new Error(`sliceRange: unsupported range ${range}`);
}

function writeRange(
  rowsState: Record<string, string[][]>,
  tab: string,
  range: string,
  values: (string | number)[][],
) {
  const rows = (rowsState[tab] ??= []);
  const single = range.match(/^B(\d+)$/);
  if (single) {
    const row = (rows[Number(single[1]) - 1] ??= []);
    row[1] = String(values[0][0]);
    return;
  }
  const pair = range.match(/^A(\d+):B\1$/);
  if (pair) {
    rows[Number(pair[1]) - 1] = values[0].map(String);
    return;
  }
  throw new Error(`writeRange: unsupported range ${range}`);
}

// zh 프로필 시트의 기본 상태 — '_정보' 탭이 없는 시트(생성 경로의 출발점).
function baseSheets(): Record<string, SheetState> {
  return {
    "sheet-zh": {
      titles: ["HSK6급"],
      rows: { HSK6급: [["한자", "병음", "뜻", "모드1", "모드2", "복습"], ["经济", "jīngjì", "경제"]] },
    },
    "sheet-en": {
      titles: ["표현"],
      rows: { 표현: [["표제어", "보조 표기", "뜻", "모드1", "모드2", "복습"], ["look up", "", "찾아보다"]] },
    },
  };
}

function settingsRequest(body: unknown, password = "pw-zh"): WorkerRequest {
  return new Request("https://example.com/api/settings", {
    method: "POST",
    headers: { Authorization: `Bearer ${password}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as WorkerRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/settings — 검증", () => {
  it("인증 헤더가 없으면 401", async () => {
    stubSheetsFetch(baseSheets());
    const req = new Request("https://example.com/api/settings", { method: "POST" }) as WorkerRequest;
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("JSON이 아닌 바디면 400", async () => {
    stubSheetsFetch(baseSheets());
    const res = await worker.fetch(settingsRequest("not-json"), env);
    expect(res.status).toBe(400);
  });

  it.each([
    ["비객체 바디", "\"30\""],
    ["sessionLimit 누락", "{}"],
    ["비정수(1.5)", JSON.stringify({ sessionLimit: 1.5 })],
    ["문자열 값", JSON.stringify({ sessionLimit: "30" })],
    ["하한 밖(0)", JSON.stringify({ sessionLimit: 0 })],
    ["상한 밖(501)", JSON.stringify({ sessionLimit: 501 })],
  ])("%s면 400 — 시트 접근 없음", async (_label, rawBody) => {
    const { urls } = stubSheetsFetch(baseSheets());
    const res = await worker.fetch(settingsRequest(rawBody), env);
    expect(res.status).toBe(400);
    expect(urls).toEqual([]);
  });

  it("400 오류 문구에 허용 범위(1~500)를 명시한다", async () => {
    stubSheetsFetch(baseSheets());
    const res = await worker.fetch(settingsRequest({ sessionLimit: 0 }), env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("1~500");
  });

  it.each([[1], [500]])("경계값 %i은 200과 반영값 응답", async (limit) => {
    const sheets = baseSheets();
    sheets["sheet-zh"].titles.push("_정보");
    sheets["sheet-zh"].rows["_정보"] = [["문제수", "60"]];
    stubSheetsFetch(sheets);
    const res = await worker.fetch(settingsRequest({ sessionLimit: limit }), env);
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ sessionLimit: limit });
  });
});

describe("POST /api/settings — 탭 생성 / 행 추가 / B열 갱신", () => {
  it("'_정보' 탭이 없으면 빈 탭을 만들고 A1:B1에만 쓴다 — 헤더 복사 없음", async () => {
    const sheets = baseSheets();
    const { putCalls } = stubSheetsFetch(sheets);

    const res = await worker.fetch(settingsRequest({ sessionLimit: 30 }), env);

    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ sessionLimit: 30 });
    expect(sheets["sheet-zh"].titles).toContain("_정보");
    // PUT은 설정 행 단 1건 — 단어 탭 createTab과 달리 헤더 행 PUT이 없어야 한다.
    expect(putCalls).toEqual([
      { sheetId: "sheet-zh", tab: "_정보", range: "A1:B1", values: [["문제수", 30]] },
    ]);
  });

  it("탭은 있고 문제수 행이 없으면 첫 빈 행에 [문제수, n]을 추가한다 — 다른 행 불가침", async () => {
    const sheets = baseSheets();
    sheets["sheet-zh"].titles.push("_정보");
    sheets["sheet-zh"].rows["_정보"] = [["다른키", "x"]];
    const { putCalls } = stubSheetsFetch(sheets);

    const res = await worker.fetch(settingsRequest({ sessionLimit: 45 }), env);

    expect(res.status).toBe(200);
    expect(sheets["sheet-zh"].titles.filter((t) => t === "_정보")).toHaveLength(1);
    expect(putCalls).toEqual([
      { sheetId: "sheet-zh", tab: "_정보", range: "A2:B2", values: [["문제수", 45]] },
    ]);
    expect(sheets["sheet-zh"].rows["_정보"][0]).toEqual(["다른키", "x"]);
  });

  it("문제수 행이 있으면 그 행 B열만 갱신한다 — 위아래 행·A열 불가침", async () => {
    const sheets = baseSheets();
    sheets["sheet-zh"].titles.push("_정보");
    sheets["sheet-zh"].rows["_정보"] = [
      ["기타", "1"],
      ["문제수", "60"],
      ["아래", "y"],
    ];
    const { putCalls } = stubSheetsFetch(sheets);

    const res = await worker.fetch(settingsRequest({ sessionLimit: 45 }), env);

    expect(res.status).toBe(200);
    expect(putCalls).toEqual([{ sheetId: "sheet-zh", tab: "_정보", range: "B2", values: [[45]] }]);
    expect(sheets["sheet-zh"].rows["_정보"]).toEqual([
      ["기타", "1"],
      ["문제수", "45"],
      ["아래", "y"],
    ]);
  });

  it("키는 앞뒤 공백을 트림해 정확 일치로 찾는다", async () => {
    const sheets = baseSheets();
    sheets["sheet-zh"].titles.push("_정보");
    sheets["sheet-zh"].rows["_정보"] = [[" 문제수 ", "60"]];
    const { putCalls } = stubSheetsFetch(sheets);

    await worker.fetch(settingsRequest({ sessionLimit: 45 }), env);

    expect(putCalls).toEqual([{ sheetId: "sheet-zh", tab: "_정보", range: "B1", values: [[45]] }]);
  });

  it("A열만 비고 B열에 값이 있는 행은 빈 행으로 치지 않는다 — 값 덮어쓰기 방지", async () => {
    const sheets = baseSheets();
    sheets["sheet-zh"].titles.push("_정보");
    sheets["sheet-zh"].rows["_정보"] = [
      ["", "값만"],
      ["키", "x"],
    ];
    const { putCalls } = stubSheetsFetch(sheets);

    await worker.fetch(settingsRequest({ sessionLimit: 45 }), env);

    expect(putCalls).toEqual([
      { sheetId: "sheet-zh", tab: "_정보", range: "A3:B3", values: [["문제수", 45]] },
    ]);
    expect(sheets["sheet-zh"].rows["_정보"][0]).toEqual(["", "값만"]);
  });

  it("중간의 완전 빈 행이 첫 빈 행이다", async () => {
    const sheets = baseSheets();
    sheets["sheet-zh"].titles.push("_정보");
    sheets["sheet-zh"].rows["_정보"] = [["기타", "1"], [], ["아래", "y"]];
    const { putCalls } = stubSheetsFetch(sheets);

    await worker.fetch(settingsRequest({ sessionLimit: 45 }), env);

    expect(putCalls).toEqual([
      { sheetId: "sheet-zh", tab: "_정보", range: "A2:B2", values: [["문제수", 45]] },
    ]);
    expect(sheets["sheet-zh"].rows["_정보"][2]).toEqual(["아래", "y"]);
  });
});

describe("POST /api/settings — 프로필 시트 격리", () => {
  it("인증 프로필의 sheetId로만 호출하고 쓰기는 RAW다", async () => {
    const { urls, putCalls } = stubSheetsFetch(baseSheets());

    const res = await worker.fetch(settingsRequest({ sessionLimit: 30 }, "pw-en"), env);

    expect(res.status).toBe(200);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain("/spreadsheets/sheet-en");
      expect(url).not.toContain("sheet-zh");
    }
    expect(putCalls).toEqual([
      { sheetId: "sheet-en", tab: "_정보", range: "A1:B1", values: [["문제수", 30]] },
    ]);
    const putUrl = urls.find((url) => url.includes("A1"));
    expect(putUrl).toContain("valueInputOption=RAW");
  });
});

describe("'_정보' 탭 자연 제외 회귀 — 기존 `_` 규칙", () => {
  it("'_정보'가 있어도 GET /api/tabs 목록과 GET /api/words 조회 대상에서 빠진다", async () => {
    const sheets = baseSheets();
    sheets["sheet-zh"].titles.push("_정보");
    sheets["sheet-zh"].rows["_정보"] = [["문제수", "30"]];
    const { urls } = stubSheetsFetch(sheets);

    const tabsRes = await worker.fetch(makeRequest("/api/tabs", { Authorization: "Bearer pw-zh" }), env);
    expect((await tabsRes.json()) as object).toEqual({ tabs: ["HSK6급"] });

    const wordsRes = await worker.fetch(makeRequest("/api/words", { Authorization: "Bearer pw-zh" }), env);
    expect(wordsRes.status).toBe(200);
    const words = ((await wordsRes.json()) as { words: { tab: string }[] }).words;
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((word) => word.tab === "HSK6급")).toBe(true);
    // 값 조회(values GET)가 '_정보' 탭으로는 한 번도 나가지 않아야 한다.
    const valueUrls = urls.filter((url) => url.includes("/values/"));
    expect(valueUrls.length).toBeGreaterThan(0);
    for (const url of valueUrls) {
      expect(decodeURIComponent(url)).not.toContain("_정보");
    }
  });
});
