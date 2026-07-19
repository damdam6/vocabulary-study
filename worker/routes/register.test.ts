import { afterEach, describe, expect, it, vi } from "vitest";

// 실제 RSA 서명 없이 라우트를 테스트하기 위해 토큰 발급 자체를 모킹한다 —
// sheets.ts가 이 모듈의 getAccessToken을 그대로 가져다 쓴다.
vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { MAX_REGISTER_WORDS } from "../lib/register.ts";

const PASSWORD = "test-password";
type WorkerRequest = Parameters<typeof worker.fetch>[0];

interface SheetsState {
  titles: string[];
  rows: Record<string, string[][]>;
}

interface PutCall {
  tab: string;
  range: string;
  values: string[][];
}

// Google Sheets API v4 호출을 가로채 메모리 상의 탭별 행 배열(state.rows)로 흉내 낸다.
// register.ts가 실제로 쓰는 range 형태(1:1 / A2:A / A1 / A{n}:C{m})만 지원한다.
function stubSheetsFetch(state: SheetsState): { putCalls: PutCall[] } {
  const putCalls: PutCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

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
        putCalls.push({ tab, range, values });
        writeRange(state.rows, tab, range, values);
        return Response.json({ updatedRange: range });
      }

      throw new Error(`unhandled mock request: ${method} ${url}`);
    }),
  );

  return { putCalls };
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

const HEADER = ["한자", "병음", "뜻", "모드1", "모드2", "복습"];

function baseState(): SheetsState {
  return {
    titles: ["HSK6급"],
    rows: { HSK6급: [HEADER, ["经济", "jīngjì", "경제"]] },
  };
}

function registerRequest(body: unknown): WorkerRequest {
  return new Request("https://example.com/api/words/register", {
    method: "POST",
    headers: { Authorization: `Bearer ${PASSWORD}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as WorkerRequest;
}

const env = { APP_PASSWORD: PASSWORD, SHEET_ID: "test-sheet-id" } as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/words/register", () => {
  it("인증 헤더가 없으면 401", async () => {
    stubSheetsFetch(baseState());
    const req = new Request("https://example.com/api/words/register", { method: "POST" }) as WorkerRequest;
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("탭 이름이 _로 시작하면 400", async () => {
    stubSheetsFetch(baseState());
    const res = await worker.fetch(
      registerRequest({ tab: "_메모", words: [{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }] }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("words 스키마 위반(필드 누락)이면 400", async () => {
    stubSheetsFetch(baseState());
    const res = await worker.fetch(
      registerRequest({ tab: "HSK6급", words: [{ hanzi: "经济", pinyin: "jīngjì" }] }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("한자가 유니코드 범위(U+4E00–U+9FFF) 밖이면 400", async () => {
    stubSheetsFetch(baseState());
    const res = await worker.fetch(
      registerRequest({ tab: "HSK6급", words: [{ hanzi: "㐀", pinyin: "jīngjì", meaning: "경제" }] }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("병음이 숫자 성조 표기면 400", async () => {
    stubSheetsFetch(baseState());
    const res = await worker.fetch(
      registerRequest({ tab: "HSK6급", words: [{ hanzi: "严重", pinyin: "yan2zhong4", meaning: "심각하다" }] }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("words가 100건을 초과하면 400", async () => {
    stubSheetsFetch(baseState());
    const words = Array.from({ length: MAX_REGISTER_WORDS + 1 }, () => ({
      hanzi: "经济",
      pinyin: "jīngjì",
      meaning: "경제",
    }));
    const res = await worker.fetch(registerRequest({ tab: "HSK6급", words }), env);
    expect(res.status).toBe(400);
  });

  it("존재하지 않는 탭 + createTab 없으면 400", async () => {
    stubSheetsFetch(baseState());
    const res = await worker.fetch(
      registerRequest({ tab: "없는탭", words: [{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }] }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("탭 내 중복 한자는 skipped로 응답되고 기존 행은 수정되지 않는다", async () => {
    const state = baseState();
    const { putCalls } = stubSheetsFetch(state);

    const res = await worker.fetch(
      registerRequest({
        tab: "HSK6급",
        words: [
          { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
          { hanzi: "严重", pinyin: "yánzhòng", meaning: "심각하다" },
        ],
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tab: string; created: boolean; added: unknown[]; skipped: string[] };
    expect(body.skipped).toEqual(["经济"]);
    expect(body.added).toEqual([{ hanzi: "严重", pinyin: "yánzhòng", meaning: "심각하다" }]);
    // 신규 단어만 다음 빈 행(3행)에 쓰고, 기존 2행을 건드리는 PUT은 없어야 한다.
    expect(putCalls).toEqual([{ tab: "HSK6급", range: "A3:C3", values: [["严重", "yánzhòng", "심각하다"]] }]);
    expect(state.rows.HSK6급[1]).toEqual(["经济", "jīngjì", "경제"]);
  });

  it("신규 단어만 있으면 다음 빈 행부터 A~C열에만 append한다", async () => {
    const { putCalls } = stubSheetsFetch(baseState());

    await worker.fetch(
      registerRequest({
        tab: "HSK6급",
        words: [
          { hanzi: "严重", pinyin: "yánzhòng", meaning: "심각하다" },
          { hanzi: "教育", pinyin: "jiàoyù", meaning: "교육" },
        ],
      }),
      env,
    );

    expect(putCalls).toEqual([
      {
        tab: "HSK6급",
        range: "A3:C4",
        values: [
          ["严重", "yánzhòng", "심각하다"],
          ["教育", "jiàoyù", "교육"],
        ],
      },
    ]);
  });

  it("createTab: true + 새 탭 이름이면 기존 탭 헤더를 복사해 생성 후 2행부터 등록한다", async () => {
    const state = baseState();
    const { putCalls } = stubSheetsFetch(state);

    const res = await worker.fetch(
      registerRequest({
        tab: "신규탭",
        createTab: true,
        words: [{ hanzi: "教育", pinyin: "jiàoyù", meaning: "교육" }],
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean };
    expect(body.created).toBe(true);
    expect(state.titles).toContain("신규탭");
    expect(putCalls).toEqual([
      { tab: "신규탭", range: "A1", values: [HEADER] },
      { tab: "신규탭", range: "A2:C2", values: [["教育", "jiàoyù", "교육"]] },
    ]);
  });

  it("트림 후 기존 탭과 이름이 같으면 createTab: true여도 새로 만들지 않는다", async () => {
    const state = baseState();
    const { putCalls } = stubSheetsFetch(state);
    const titleCountBefore = state.titles.length;

    const res = await worker.fetch(
      registerRequest({
        tab: "  HSK6급  ",
        createTab: true,
        words: [{ hanzi: "教育", pinyin: "jiàoyù", meaning: "교육" }],
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tab: string; created: boolean };
    expect(body.tab).toBe("HSK6급");
    expect(body.created).toBe(false);
    expect(state.titles.length).toBe(titleCountBefore);
    expect(putCalls.some((c) => c.range === "A1")).toBe(false);
  });
});
