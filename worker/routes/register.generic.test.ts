import { afterEach, describe, expect, it, vi } from "vitest";

// 실제 RSA 서명 없이 라우트를 테스트하기 위해 토큰 발급 자체를 모킹한다 —
// sheets.ts가 이 모듈의 getAccessToken을 그대로 가져다 쓴다.
vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { MAX_REGISTER_WORDS } from "../lib/register.ts";
import { makeEnv } from "../test-utils.ts";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

// generic 등록 스위트(#95, 등록 일반화 플랜 §3.2·§3.3) — getProfiles·다이제스트 캐시가
// isolate 수명 동안 첫 성공 구성을 고정하므로 이 파일 전체가 단일 PROFILES(zh+generic)를
// 쓴다("테스트 파일 = isolate" 규약). 폴백(zh) 구성의 라우트 스위트는 register.test.ts.
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

function baseSheets(): Record<string, SheetsState> {
  return {
    "sheet-zh": {
      titles: ["HSK6급"],
      rows: { HSK6급: [ZH_HEADER, ["经济", "jīngjì", "경제"]] },
    },
    "sheet-en": {
      titles: ["표현"],
      rows: { 표현: [GENERIC_HEADER, ["look up", "", "찾아보다"]] },
    },
  };
}

// register.ts가 실제로 쓰는 요청(?fields= 탭 조회 · addSheet batchUpdate · 1:1/A2:A GET ·
// A1/A{n}:C{m} PUT)만 sheetId별 상태로 흉내 내고, 호출 URL 전부를 기록한다 — 시트 격리
// 검증(index.sheet-isolation.test.ts 패턴)과 쓰기 검증(register.test.ts 패턴)의 결합.
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

      const { tab, range } = parseTabRange(url);

      if (method === "GET") {
        return Response.json({ values: sliceRange(state.rows[tab] ?? [], range) });
      }

      if (method === "PUT") {
        const values = (JSON.parse(init?.body as string) as { values: string[][] }).values;
        putCalls.push({ sheetId, tab, range, values });
        writeRange(state.rows, tab, range, values);
        return Response.json({ updatedRange: range });
      }

      throw new Error(`unhandled mock request: ${method} ${url}`);
    }),
  );

  return { putCalls, urls };
}

function parseTabRange(url: string): { tab: string; range: string } {
  const afterValues = url.split("/values/")[1];
  const decoded = decodeURIComponent(afterValues.split("?")[0]);
  const bang = decoded.indexOf("!");
  return { tab: decoded.slice(1, bang - 1), range: decoded.slice(bang + 1) };
}

function sliceRange(rows: string[][], range: string): string[][] {
  if (range === "1:1") {
    return rows[0] ? [rows[0]] : [];
  }
  if (range === "A2:A") {
    return rows.slice(1).filter((r) => r[0]).map((r) => [r[0]]);
  }
  throw new Error(`sliceRange: unsupported range ${range}`);
}

function writeRange(rowsState: Record<string, string[][]>, tab: string, range: string, values: string[][]) {
  const rows = (rowsState[tab] ??= []);
  if (range === "A1") {
    rows[0] = values[0];
    return;
  }
  const match = range.match(/^A(\d+):C(\d+)$/);
  if (!match) {
    throw new Error(`writeRange: unsupported range ${range}`);
  }
  const startRow = Number(match[1]);
  values.forEach((value, i) => {
    rows[startRow - 1 + i] = value;
  });
}

function registerRequest(password: string, body: unknown): WorkerRequest {
  return new Request("https://example.com/api/words/register", {
    method: "POST",
    headers: { Authorization: `Bearer ${password}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as WorkerRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/words/register — generic 프로필", () => {
  it("B열 빈칸·자유 텍스트 표제어(공백·문장부호)를 등록하고 A~C열에만 append한다", async () => {
    const { putCalls } = stubSheetsFetch(baseSheets());

    const res = await worker.fetch(
      registerRequest("pw-en", {
        tab: "표현",
        words: [
          { hanzi: "take off", pinyin: "", meaning: "이륙하다" },
          { hanzi: "run into!", pinyin: "숙어", meaning: "우연히 만나다" },
        ],
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tab: string; created: boolean; added: unknown[]; skipped: string[] };
    expect(body).toEqual({
      tab: "표현",
      created: false,
      added: [
        { hanzi: "take off", pinyin: "", meaning: "이륙하다" },
        { hanzi: "run into!", pinyin: "숙어", meaning: "우연히 만나다" },
      ],
      skipped: [],
    });
    expect(putCalls).toEqual([
      {
        sheetId: "sheet-en",
        tab: "표현",
        range: "A3:C4",
        values: [
          ["take off", "", "이륙하다"],
          ["run into!", "숙어", "우연히 만나다"],
        ],
      },
    ]);
  });

  it("시트 내 표제어 중복은 정확 일치로만 skipped — 대소문자가 다르면 신규다(§8 Q4)", async () => {
    const { putCalls } = stubSheetsFetch(baseSheets());

    const res = await worker.fetch(
      registerRequest("pw-en", {
        tab: "표현",
        words: [
          { hanzi: "look up", pinyin: "", meaning: "찾아보다" },
          { hanzi: "Look up", pinyin: "", meaning: "올려다보다" },
        ],
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: unknown[]; skipped: string[] };
    expect(body.skipped).toEqual(["look up"]);
    expect(body.added).toEqual([{ hanzi: "Look up", pinyin: "", meaning: "올려다보다" }]);
    expect(putCalls).toEqual([
      { sheetId: "sheet-en", tab: "표현", range: "A3:C3", values: [["Look up", "", "올려다보다"]] },
    ]);
  });

  it("배치 내 표제어 중복이면 400", async () => {
    stubSheetsFetch(baseSheets());
    const res = await worker.fetch(
      registerRequest("pw-en", {
        tab: "표현",
        words: [
          { hanzi: "take off", pinyin: "", meaning: "이륙하다" },
          { hanzi: "take off", pinyin: "", meaning: "벗다" },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("meaning이 빈칸이면 400", async () => {
    stubSheetsFetch(baseSheets());
    const res = await worker.fetch(
      registerRequest("pw-en", { tab: "표현", words: [{ hanzi: "take off", pinyin: "", meaning: " " }] }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("100건을 초과하면 400", async () => {
    stubSheetsFetch(baseSheets());
    const words = Array.from({ length: MAX_REGISTER_WORDS + 1 }, (_, i) => ({
      hanzi: `expr ${i}`,
      pinyin: "",
      meaning: "뜻",
    }));
    const res = await worker.fetch(registerRequest("pw-en", { tab: "표현", words }), env);
    expect(res.status).toBe(400);
  });

  it("400 문구가 contentType별로 갈린다 — generic 문구엔 성조·유니코드 전제가 없다", async () => {
    stubSheetsFetch(baseSheets());

    const resEn = await worker.fetch(
      registerRequest("pw-en", { tab: "표현", words: [{ hanzi: " ", pinyin: "", meaning: "" }] }),
      env,
    );
    expect(resEn.status).toBe(400);
    const en = (await resEn.json()) as { error: string };
    expect(en.error).toContain("표제어");
    expect(en.error).not.toContain("성조");
    expect(en.error).not.toContain("U+4E00");

    const resZh = await worker.fetch(
      registerRequest("pw-zh", { tab: "HSK6급", words: [{ hanzi: " ", pinyin: "", meaning: "" }] }),
      env,
    );
    expect(resZh.status).toBe(400);
    const zh = (await resZh.json()) as { error: string };
    expect(zh.error).toContain("성조");
  });

  it("generic 완화가 zh 프로필에 새지 않는다 — 같은 구성의 zh는 자유 텍스트·빈 병음을 400으로 거부한다", async () => {
    stubSheetsFetch(baseSheets());
    const res = await worker.fetch(
      registerRequest("pw-zh", { tab: "HSK6급", words: [{ hanzi: "take off", pinyin: "", meaning: "이륙하다" }] }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("탭 0개 + createTab이면 generic 기본 헤더(A~F)로 첫 탭을 만들고 2행부터 등록한다", async () => {
    const sheets = baseSheets();
    sheets["sheet-en"] = { titles: [], rows: {} };
    const { putCalls } = stubSheetsFetch(sheets);

    const res = await worker.fetch(
      registerRequest("pw-en", {
        tab: "표현",
        createTab: true,
        words: [{ hanzi: "take off", pinyin: "", meaning: "이륙하다" }],
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean };
    expect(body.created).toBe(true);
    expect(putCalls).toEqual([
      { sheetId: "sheet-en", tab: "표현", range: "A1", values: [GENERIC_HEADER] },
      { sheetId: "sheet-en", tab: "표현", range: "A2:C2", values: [["take off", "", "이륙하다"]] },
    ]);
  });

  it("모든 Sheets 호출이 인증 프로필의 sheetId로만 나간다 (시트 격리)", async () => {
    const { urls } = stubSheetsFetch(baseSheets());

    const res = await worker.fetch(
      registerRequest("pw-en", { tab: "표현", words: [{ hanzi: "get by", pinyin: "", meaning: "그럭저럭 살다" }] }),
      env,
    );

    expect(res.status).toBe(200);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain("/spreadsheets/sheet-en");
      expect(url).not.toContain("sheet-zh");
    }
  });
});
