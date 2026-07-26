import { afterEach, describe, expect, it, vi } from "vitest";

// register.test.ts와 같은 이유로 실제 RSA 서명 없이 라우트를 테스트한다.
vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { makeEnv } from "../test-utils.ts";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

// PROFILES §5.2 — 이 스위트 전용 3프로필(단일 모드 2개 + 듀얼 모드 1개)로 모드 게이트와
// 졸업 판정을 프로필 경계별로 검증한다.
const PROFILES = [
  { id: "m1only", name: "모드1 전용", password: "pw-m1only", sheetId: "sheet-m1only", modes: ["m1"], contentType: "zh" },
  { id: "m2only", name: "모드2 전용", password: "pw-m2only", sheetId: "sheet-m2only", modes: ["m2"], contentType: "zh" },
  { id: "both", name: "듀얼 모드", password: "pw-both", sheetId: "sheet-both", modes: ["m1", "m2"], contentType: "zh" },
];
const env = makeEnv({ PROFILES: JSON.stringify(PROFILES) });

const TAB = "HSK6급";

interface SheetsState {
  // index 0 = 헤더(1행), index n = 시트 (n+1)행. D·E·F열은 시트가 실제로 반환하는 대로 문자열로 둔다.
  rows: Record<string, string[][]>;
}

interface CellWrite {
  tab: string;
  cell: string;
  value: string | number;
}

function wordRow(m1: number, m2: number, nextReviewRaw = ""): string[] {
  return ["经济", "jīngjì", "경제", String(m1), String(m2), nextReviewRaw];
}

function baseState(row: string[]): SheetsState {
  return { rows: { [TAB]: [["한자", "병음", "뜻", "모드1", "모드2", "복습"], row] } };
}

function parseFullRange(fullRange: string): { tab: string; range: string } {
  const bang = fullRange.lastIndexOf("!");
  let tab = fullRange.slice(0, bang);
  if (tab.startsWith("'") && tab.endsWith("'")) {
    tab = tab.slice(1, -1).replaceAll("''", "'");
  }
  return { tab, range: fullRange.slice(bang + 1) };
}

function parseUrlTabRange(url: string): { tab: string; range: string } {
  const afterValues = url.split("/values/")[1];
  const decoded = decodeURIComponent(afterValues.split("?")[0]);
  return parseFullRange(decoded);
}

// columnLetter(worker/lib/answer.ts)의 역변환 — 목이 batchUpdate 셀 주소를 되읽는 데만 쓴다.
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** answer.ts가 실제로 쓰는 범위 어휘(A2:A · {row}:{row} GET, /values:batchUpdate POST)만 지원하는 목. */
function stubSheetsFetch(state: SheetsState): { writes: CellWrite[]; fetchMock: ReturnType<typeof vi.fn> } {
  const writes: CellWrite[] = [];

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? "GET";

    if (method === "GET") {
      const { tab, range } = parseUrlTabRange(url);
      const rows = state.rows[tab] ?? [];
      if (range === "A2:A") {
        return Response.json({ values: rows.slice(1).map((r) => [r[0] ?? ""]) });
      }
      const rowMatch = range.match(/^(\d+):(\d+)$/);
      if (rowMatch) {
        const row = rows[Number(rowMatch[1]) - 1];
        return Response.json({ values: row ? [row] : [] });
      }
      throw new Error(`stubSheetsFetch: unsupported GET range ${range}`);
    }

    if (method === "POST" && url.includes("/values:batchUpdate")) {
      const body = JSON.parse(init?.body as string) as {
        data: { range: string; values: (string | number)[][] }[];
      };
      for (const { range, values } of body.data) {
        const { tab, range: cell } = parseFullRange(range);
        const match = cell.match(/^([A-Z]+)(\d+)$/);
        if (!match) throw new Error(`stubSheetsFetch: unsupported cell ${cell}`);
        const rowNumber = Number(match[2]);
        const rows = (state.rows[tab] ??= []);
        const row = (rows[rowNumber - 1] ??= []);
        row[columnIndex(match[1])] = String(values[0][0]);
        writes.push({ tab, cell, value: values[0][0] });
      }
      return Response.json({});
    }

    throw new Error(`stubSheetsFetch: unhandled request ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { writes, fetchMock };
}

function answerRequest(password: string, body: unknown): WorkerRequest {
  return new Request("https://example.com/api/answer", {
    method: "POST",
    headers: { Authorization: `Bearer ${password}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as WorkerRequest;
}

interface AnswerBody {
  tab: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  m1: number;
  m2: number;
  nextReview: string | null;
  interval: number | null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/answer — 비활성 모드 400 (PRD-general §5.2)", () => {
  it("M={m1} 프로필에 mode:'m2' 요청 → 400, 시트 호출 0회(읽기·쓰기 전부 생략)", async () => {
    const { writes, fetchMock } = stubSheetsFetch(baseState(wordRow(2, 0)));
    const res = await worker.fetch(
      answerRequest("pw-m1only", {
        tab: TAB,
        hanzi: "经济",
        mode: "m2",
        timestamp: "2026-07-27 15:00",
        isReview: false,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("M={m2} 프로필에 mode:'m1' 요청 → 400, 시트 호출 0회", async () => {
    const { writes, fetchMock } = stubSheetsFetch(baseState(wordRow(0, 2)));
    const res = await worker.fetch(
      answerRequest("pw-m2only", {
        tab: TAB,
        hanzi: "经济",
        mode: "m1",
        timestamp: "2026-07-27 15:00",
        isReview: false,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/answer — M = {m1} 단일 모드 프로필 졸업", () => {
  it("D열 3번째 정답 시 졸업 — F열에 내일|1 기록 (E열 값과 무관)", async () => {
    const { writes } = stubSheetsFetch(baseState(wordRow(2, 5)));
    const res = await worker.fetch(
      answerRequest("pw-m1only", {
        tab: TAB,
        hanzi: "经济",
        mode: "m1",
        timestamp: "2026-07-27 15:00",
        isReview: false,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnswerBody;
    expect(body.m1).toBe(3);
    expect(body.m2).toBe(5);
    expect(body.interval).toBe(1);
    expect(body.nextReview).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(writes).toContainEqual({ tab: TAB, cell: "D2", value: 3 });
    expect(writes).toContainEqual({ tab: TAB, cell: "G2", value: "2026-07-27 15:00|m1" });
    const fWrite = writes.find((w) => w.cell === "F2");
    expect(fWrite?.value).toMatch(/^\d{4}-\d{2}-\d{2}\|1$/);
  });
});

describe("POST /api/answer — M = {m2} 단일 모드 프로필 졸업 (대칭)", () => {
  it("E열 3번째 정답 시 졸업 — F열에 내일|1 기록 (D열 값과 무관)", async () => {
    const { writes } = stubSheetsFetch(baseState(wordRow(5, 2)));
    const res = await worker.fetch(
      answerRequest("pw-m2only", {
        tab: TAB,
        hanzi: "经济",
        mode: "m2",
        timestamp: "2026-07-27 15:00",
        isReview: false,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnswerBody;
    expect(body.m1).toBe(5);
    expect(body.m2).toBe(3);
    expect(body.interval).toBe(1);
    expect(body.nextReview).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(writes).toContainEqual({ tab: TAB, cell: "E2", value: 3 });
    const fWrite = writes.find((w) => w.cell === "F2");
    expect(fWrite?.value).toMatch(/^\d{4}-\d{2}-\d{2}\|1$/);
  });
});

describe("POST /api/answer — M = {m1, m2} 기존 동작 보존 (인자 추가만)", () => {
  it("학습 중(둘 다 3 미만) 정답은 카운트만 증가 — 응답 단어 객체 형태 불변", async () => {
    const { writes } = stubSheetsFetch(baseState(wordRow(0, 1)));
    const res = await worker.fetch(
      answerRequest("pw-both", {
        tab: TAB,
        hanzi: "经济",
        mode: "m1",
        timestamp: "2026-07-27 15:00",
        isReview: false,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnswerBody;
    expect(body).toEqual({
      tab: TAB,
      hanzi: "经济",
      pinyin: "jīngjì",
      meaning: "경제",
      m1: 1,
      m2: 1,
      nextReview: null,
      interval: null,
    });
    expect(writes.some((w) => w.cell === "F2")).toBe(false);
  });

  it("둘 다 3에 도달하는 순간 첫 졸업 — F열 기록", async () => {
    const { writes } = stubSheetsFetch(baseState(wordRow(2, 3)));
    const res = await worker.fetch(
      answerRequest("pw-both", {
        tab: TAB,
        hanzi: "经济",
        mode: "m1",
        timestamp: "2026-07-27 15:00",
        isReview: false,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnswerBody;
    expect(body.m1).toBe(3);
    expect(body.m2).toBe(3);
    expect(body.interval).toBe(1);
    const fWrite = writes.find((w) => w.cell === "F2");
    expect(fWrite?.value).toMatch(/^\d{4}-\d{2}-\d{2}\|1$/);
  });

  it("복습 정답은 간격 사다리를 올린다 (졸업 상태 무관)", async () => {
    const { writes } = stubSheetsFetch(baseState(wordRow(3, 3, "2026-07-20|3")));
    const res = await worker.fetch(
      answerRequest("pw-both", {
        tab: TAB,
        hanzi: "经济",
        mode: "m2",
        timestamp: "2026-07-27 15:00",
        isReview: true,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnswerBody;
    expect(body.interval).toBe(7);
    expect(body.nextReview).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const fWrite = writes.find((w) => w.cell === "F2");
    expect(fWrite?.value).toMatch(/^\d{4}-\d{2}-\d{2}\|7$/);
  });
});
