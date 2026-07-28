import { afterEach, describe, expect, it, vi } from "vitest";

// 실제 RSA 서명 없이 라우트를 테스트하기 위해 토큰 발급 자체를 모킹한다 —
// sheets.ts가 이 모듈의 getAccessToken을 그대로 가져다 쓴다.
vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { makeEnv } from "../test-utils.ts";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

// POST /api/tabs generic·격리 스위트(#120) — getProfiles·다이제스트 캐시가 isolate 수명
// 동안 첫 성공 구성을 고정하므로 이 파일 전체가 단일 PROFILES(zh+generic)를 쓴다
// ("테스트 파일 = isolate" 규약). 폴백(zh) 구성의 POST 스위트는 tabs.test.ts.
const PROFILES = [
  { id: "zh", name: "중국어 단어", password: "pw-zh", sheetId: "sheet-zh", modes: ["m1", "m2"], contentType: "zh" },
  { id: "en", name: "영어 표현", password: "pw-en", sheetId: "sheet-en", modes: ["m1"], contentType: "generic" },
];
const env = makeEnv({ PROFILES: JSON.stringify(PROFILES) });

interface SheetsState {
  titles: string[];
  rows: Record<string, string[][]>;
}

interface PutCall {
  sheetId: string;
  tab: string;
  range: string;
  values: string[][];
}

const ZH_HEADER = ["한자", "병음", "뜻", "모드1", "모드2", "복습"];
const GENERIC_HEADER = ["표제어", "보조 표기", "뜻", "모드1", "모드2", "복습"];

// 탭 생성 경로가 실제로 쓰는 요청(?fields= 탭 조회 · addSheet batchUpdate · 1:1 GET ·
// A1 PUT)만 sheetId별 상태로 흉내 내고, 호출 URL 전부를 기록한다 — 시트 격리 검증
// (index.sheet-isolation.test.ts 패턴)과 쓰기 검증(tabs.test.ts 패턴)의 결합.
function stubSheetsFetch(sheets: Record<string, SheetsState>): { putCalls: PutCall[]; urls: string[] } {
  const putCalls: PutCall[] = [];
  const urls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      urls.push(url);
      const method = init?.method ?? "GET";
      const sheetId = url.match(/\/spreadsheets\/([^/:?]+)/)?.[1] ?? "";
      const state = sheets[sheetId];
      if (!state) {
        return new Response("sheet not found", { status: 404 });
      }

      if (method === "GET" && url.includes("?fields=")) {
        return Response.json({ sheets: state.titles.map((title) => ({ properties: { title } })) });
      }

      if (url.includes(":batchUpdate") && !url.includes("/values:batchUpdate")) {
        const body = JSON.parse(init?.body as string) as {
          requests: { addSheet?: { properties: { title: string } } }[];
        };
        for (const req of body.requests) {
          if (req.addSheet) {
            state.titles.push(req.addSheet.properties.title);
            state.rows[req.addSheet.properties.title] = [];
          }
        }
        return Response.json({});
      }

      const afterValues = url.split("/values/")[1];
      const decoded = decodeURIComponent(afterValues.split("?")[0]);
      const bang = decoded.indexOf("!");
      const tab = decoded.slice(1, bang - 1);
      const range = decoded.slice(bang + 1);

      if (method === "GET" && range === "1:1") {
        const rows = state.rows[tab] ?? [];
        return Response.json({ values: rows[0] ? [rows[0]] : [] });
      }

      if (method === "PUT" && range === "A1") {
        const values = (JSON.parse(init?.body as string) as { values: string[][] }).values;
        putCalls.push({ sheetId, tab, range, values });
        (state.rows[tab] ??= [])[0] = values[0];
        return Response.json({ updatedRange: range });
      }

      throw new Error(`unhandled mock request: ${method} ${url}`);
    }),
  );

  return { putCalls, urls };
}

function createTabRequest(password: string, body: unknown): WorkerRequest {
  return new Request("https://example.com/api/tabs", {
    method: "POST",
    headers: { Authorization: `Bearer ${password}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as WorkerRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/tabs — generic 프로필", () => {
  it("학습 대상 탭이 0개면 generic 기본 헤더로 부트스트랩한다", async () => {
    const { putCalls } = stubSheetsFetch({
      "sheet-en": { titles: [], rows: {} },
    });

    const res = await worker.fetch(createTabRequest("pw-en", { name: "표현" }), env);

    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ name: "표현", created: true });
    expect(putCalls).toEqual([{ sheetId: "sheet-en", tab: "표현", range: "A1", values: [GENERIC_HEADER] }]);
  });

  it("기존 단어 탭이 있으면 기본 헤더 대신 첫 탭의 1행 헤더를 복사한다", async () => {
    const customHeader = ["표현", "메모", "해석", "모드1", "모드2", "복습"];
    const { putCalls } = stubSheetsFetch({
      "sheet-en": { titles: ["표현"], rows: { 표현: [customHeader, ["look up", "", "찾아보다"]] } },
    });

    const res = await worker.fetch(createTabRequest("pw-en", { name: "숙어" }), env);

    expect(res.status).toBe(200);
    expect(putCalls).toEqual([{ sheetId: "sheet-en", tab: "숙어", range: "A1", values: [customHeader] }]);
  });
});

describe("POST /api/tabs — 프로필별 시트 격리", () => {
  it("각 프로필의 생성 요청은 그 프로필의 sheetId로만 Sheets API를 호출한다", async () => {
    const sheets = {
      "sheet-zh": { titles: ["HSK6급"], rows: { HSK6급: [ZH_HEADER] } },
      "sheet-en": { titles: [], rows: {} },
    };
    const { putCalls, urls } = stubSheetsFetch(sheets);

    const resZh = await worker.fetch(createTabRequest("pw-zh", { name: "HSK7" }), env);
    expect(resZh.status).toBe(200);
    for (const url of urls) {
      expect(url).toContain("/spreadsheets/sheet-zh");
      expect(url).not.toContain("sheet-en");
    }

    urls.length = 0;
    const resEn = await worker.fetch(createTabRequest("pw-en", { name: "표현" }), env);
    expect(resEn.status).toBe(200);
    for (const url of urls) {
      expect(url).toContain("/spreadsheets/sheet-en");
      expect(url).not.toContain("sheet-zh");
    }

    // 쓰기도 각자 시트에만: zh는 헤더 복사, en은 generic 기본 헤더 부트스트랩.
    expect(putCalls).toEqual([
      { sheetId: "sheet-zh", tab: "HSK7", range: "A1", values: [ZH_HEADER] },
      { sheetId: "sheet-en", tab: "표현", range: "A1", values: [GENERIC_HEADER] },
    ]);
  });
});
