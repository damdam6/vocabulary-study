import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { makeEnv } from "../test-utils.ts";

const PASSWORD = "test-password";
type WorkerRequest = Parameters<typeof worker.fetch>[0];
// 이 스위트는 프로필 경계를 검증하지 않으므로 단일 프로필 하나면 충분하다 (모드는 둘 다 활성).
const PROFILES = [
  { id: "zh", name: "중국어 단어", password: PASSWORD, sheetId: "test-sheet-id", modes: ["m1", "m2"], contentType: "zh" },
];
const env = makeEnv({ PROFILES: JSON.stringify(PROFILES) });

function stubTitlesFetch(titles: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ sheets: titles.map((title) => ({ properties: { title } })) })),
  );
}

function tabsRequest(headers?: Record<string, string>): WorkerRequest {
  return new Request("https://example.com/api/tabs", { headers }) as WorkerRequest;
}

// ── POST /api/tabs(#120)용 상태 기반 스텁 — register.test.ts의 stubSheetsFetch에서
// 탭 생성 경로가 실제로 쓰는 요청(?fields= 탭 조회 · addSheet batchUpdate · 1:1 GET ·
// A1 PUT)만 가져온 축소판.

interface SheetsState {
  titles: string[];
  rows: Record<string, string[][]>;
}

interface PutCall {
  tab: string;
  range: string;
  values: string[][];
}

// 구조 batchUpdate의 request 형태(#122) — addSheet(서식 속성 포함)와 repeatCell만 온다.
interface BatchRequest {
  addSheet?: {
    properties: {
      title: string;
      sheetId?: number;
      gridProperties?: { frozenRowCount?: number };
    };
  };
  repeatCell?: {
    range: Record<string, number>;
    cell: { userEnteredFormat: { backgroundColor: { red: number; green: number; blue: number } } };
    fields: string;
  };
}

function stubSheetsFetch(state: SheetsState): {
  putCalls: PutCall[];
  addSheetCalls: string[];
  batchUpdateCalls: BatchRequest[][];
} {
  const putCalls: PutCall[] = [];
  const addSheetCalls: string[] = [];
  const batchUpdateCalls: BatchRequest[][] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET" && url.includes("?fields=")) {
        return Response.json({ sheets: state.titles.map((title) => ({ properties: { title } })) });
      }

      if (url.includes(":batchUpdate") && !url.includes("/values:batchUpdate")) {
        const body = JSON.parse(init?.body as string) as { requests: BatchRequest[] };
        batchUpdateCalls.push(body.requests);
        for (const req of body.requests) {
          if (req.addSheet) {
            addSheetCalls.push(req.addSheet.properties.title);
            state.titles.push(req.addSheet.properties.title);
            state.rows[req.addSheet.properties.title] = [];
          }
        }
        return Response.json({});
      }

      const { tab, range } = parseTabRange(url);

      if (method === "GET") {
        if (range !== "1:1") {
          throw new Error(`unhandled mock GET range: ${range}`);
        }
        const rows = state.rows[tab] ?? [];
        return Response.json({ values: rows[0] ? [rows[0]] : [] });
      }

      if (method === "PUT") {
        const values = (JSON.parse(init?.body as string) as { values: string[][] }).values;
        putCalls.push({ tab, range, values });
        if (range !== "A1") {
          throw new Error(`unhandled mock PUT range: ${range}`);
        }
        (state.rows[tab] ??= [])[0] = values[0];
        return Response.json({ updatedRange: range });
      }

      throw new Error(`unhandled mock request: ${method} ${url}`);
    }),
  );

  return { putCalls, addSheetCalls, batchUpdateCalls };
}

function parseTabRange(url: string): { tab: string; range: string } {
  const afterValues = url.split("/values/")[1];
  const decoded = decodeURIComponent(afterValues.split("?")[0]);
  const bang = decoded.indexOf("!");
  return { tab: decoded.slice(1, bang - 1), range: decoded.slice(bang + 1) };
}

const HEADER = ["한자", "병음", "뜻", "모드1", "모드2", "복습"];

function baseState(): SheetsState {
  return {
    titles: ["HSK6급", "_메모"],
    rows: { HSK6급: [HEADER, ["经济", "jīngjì", "경제"]], _메모: [["잡담"]] },
  };
}

function createTabRequest(body: unknown, headers?: Record<string, string>): WorkerRequest {
  return new Request("https://example.com/api/tabs", {
    method: "POST",
    headers: { Authorization: `Bearer ${PASSWORD}`, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as WorkerRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/tabs", () => {
  it("인증 헤더가 없으면 401", async () => {
    stubTitlesFetch(["HSK6급"]);
    const res = await worker.fetch(tabsRequest(), env);
    expect(res.status).toBe(401);
  });

  it("_ 접두 탭을 제외한 목록을 반환한다", async () => {
    stubTitlesFetch(["HSK6급", "_메모", "교재5과"]);
    const res = await worker.fetch(tabsRequest({ Authorization: `Bearer ${PASSWORD}` }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tabs: string[] };
    expect(body.tabs).toEqual(["HSK6급", "교재5과"]);
  });
});

describe("POST /api/tabs", () => {
  it("인증 헤더가 없으면 401", async () => {
    stubSheetsFetch(baseState());
    const req = new Request("https://example.com/api/tabs", {
      method: "POST",
      body: JSON.stringify({ name: "새탭" }),
    }) as WorkerRequest;
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("본문이 JSON이 아니면 400", async () => {
    stubSheetsFetch(baseState());
    const res = await worker.fetch(createTabRequest("not-json"), env);
    expect(res.status).toBe(400);
  });

  it.each([
    ["비문자열", { name: 123 }],
    ["누락", {}],
    ["트림 후 빈 값", { name: "   " }],
    ["_ 시작", { name: "_숨김" }],
  ])("이름 규칙 위반(%s)이면 400이고 탭을 만들지 않는다", async (_label, body) => {
    const { addSheetCalls } = stubSheetsFetch(baseState());
    const res = await worker.fetch(createTabRequest(body), env);
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error: string };
    expect(resBody.error).not.toBe("");
    expect(addSheetCalls).toEqual([]);
  });

  it("트림 후 기존 탭과 같으면 생성 없이 created: false로 성공한다", async () => {
    const state = baseState();
    const { putCalls, addSheetCalls, batchUpdateCalls } = stubSheetsFetch(state);

    const res = await worker.fetch(createTabRequest({ name: "  HSK6급  " }), env);

    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ name: "HSK6급", created: false });
    expect(addSheetCalls).toEqual([]);
    // 서식만 적용하는 batchUpdate도 없어야 한다 — 기존 탭 불가침(#122).
    expect(batchUpdateCalls).toEqual([]);
    expect(putCalls).toEqual([]);
  });

  it("새 이름이면 기존 첫 탭의 1행 헤더를 복사해 생성하고 created: true를 준다", async () => {
    const state = baseState();
    const { putCalls, addSheetCalls } = stubSheetsFetch(state);

    const res = await worker.fetch(createTabRequest({ name: "HSK7" }), env);

    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ name: "HSK7", created: true });
    expect(addSheetCalls).toEqual(["HSK7"]);
    // 헤더 행(A1)만 쓴다 — 다른 셀 불가침.
    expect(putCalls).toEqual([{ tab: "HSK7", range: "A1", values: [HEADER] }]);
    expect(state.titles).toContain("HSK7");
  });

  // #122: 생성은 한 번의 batchUpdate로 탭 추가 + 1행 고정 + 헤더 색 + D열 이후 배경을 적용한다.
  it("생성 batchUpdate 하나에 1행 고정과 서식 request가 함께 담긴다", async () => {
    const { batchUpdateCalls } = stubSheetsFetch(baseState());

    const res = await worker.fetch(createTabRequest({ name: "HSK7" }), env);

    expect(res.status).toBe(200);
    expect(batchUpdateCalls).toHaveLength(1);
    const [addSheetReq, ...formatReqs] = batchUpdateCalls[0];

    const props = addSheetReq.addSheet?.properties;
    expect(props?.title).toBe("HSK7");
    expect(props?.gridProperties).toEqual({ frozenRowCount: 1 });
    // 후속 repeatCell이 같은 배치에서 새 탭을 참조하도록 숫자 sheetId를 직접 지정한다.
    const gid = props?.sheetId;
    expect(typeof gid).toBe("number");

    const YELLOW = { red: 255 / 255, green: 217 / 255, blue: 102 / 255 }; // #FFD966
    const GREEN = { red: 217 / 255, green: 234 / 255, blue: 211 / 255 }; // #D9EAD3
    const GRAY = { red: 102 / 255, green: 102 / 255, blue: 102 / 255 }; // #666666
    const headerCell = (column: number) => ({
      sheetId: gid,
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: column,
      endColumnIndex: column + 1,
    });
    const bg = (backgroundColor: object) => ({ userEnteredFormat: { backgroundColor } });
    expect(formatReqs.map((req) => req.repeatCell)).toEqual([
      { range: headerCell(0), cell: bg(YELLOW), fields: "userEnteredFormat.backgroundColor" },
      { range: headerCell(1), cell: bg(GREEN), fields: "userEnteredFormat.backgroundColor" },
      { range: headerCell(2), cell: bg(YELLOW), fields: "userEnteredFormat.backgroundColor" },
      // 기록 영역(D열 이후)은 행·끝 열을 고정하지 않는 open-ended 범위다.
      {
        range: { sheetId: gid, startColumnIndex: 3 },
        cell: bg(GRAY),
        fields: "userEnteredFormat.backgroundColor",
      },
    ]);
  });

  it("학습 대상 탭이 0개면 zh 기본 헤더로 부트스트랩한다", async () => {
    const { putCalls } = stubSheetsFetch({ titles: [], rows: {} });

    const res = await worker.fetch(createTabRequest({ name: "첫탭" }), env);

    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ name: "첫탭", created: true });
    expect(putCalls).toEqual([{ tab: "첫탭", range: "A1", values: [HEADER] }]);
  });

  it("_ 접두 탭만 있으면 학습 대상 0개로 보고 그 탭 헤더를 복사하지 않고 기본 헤더를 쓴다", async () => {
    const { putCalls } = stubSheetsFetch({ titles: ["_메모"], rows: { _메모: [["잡담"]] } });

    const res = await worker.fetch(createTabRequest({ name: "첫탭" }), env);

    expect(res.status).toBe(200);
    expect(putCalls).toEqual([{ tab: "첫탭", range: "A1", values: [HEADER] }]);
  });

  it("생성 직후 GET /api/tabs 목록에 새 탭이 포함된다", async () => {
    const state = baseState();
    stubSheetsFetch(state);

    await worker.fetch(createTabRequest({ name: "HSK7" }), env);
    const res = await worker.fetch(tabsRequest({ Authorization: `Bearer ${PASSWORD}` }), env);

    expect((await res.json()) as object).toEqual({ tabs: ["HSK6급", "HSK7"] });
  });
});
