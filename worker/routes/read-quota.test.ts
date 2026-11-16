import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { makeEnv, makeRequest } from "../test-utils.ts";

// Sheets 읽기 쿼터는 분당 60회/사용자(서비스 계정 1개를 전 프로필이 공유)이고 요청 수로 센다.
// 홈 조회·정답 기록이 탭 수·단계 수만큼 읽으면 학습 중에 쿼터가 바닥나 GET /api/words가
// 429 → 500으로 떨어진다. 이 스위트는 batchGet을 풀지 않은 실제 요청 수를 고정한다.
const env = makeEnv({
  PROFILES: JSON.stringify([
    { id: "zh", name: "중국어", password: "pw-zh", sheetId: "sheet-zh", modes: ["m1", "m2"], contentType: "zh" },
  ]),
});

const TABS = ["1과", "2과", "3과", "_정보"];
const HEADER = ["한자", "병음", "뜻", "모드1", "모드2", "복습"];
const ROW = ["经济", "jīngjì", "경제", "1", "0", ""];

function stubSheets() {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.includes("?fields=")) {
      return Response.json({ sheets: TABS.map((title, sheetId) => ({ properties: { title, sheetId } })) });
    }
    if (url.includes("/values:batchGet?")) {
      const ranges = new URL(url).searchParams.getAll("ranges");
      return Response.json({
        valueRanges: ranges.map((range) => {
          if (range.startsWith("'_정보'")) return { values: [["문제수", "30"]] };
          // 탭 전체(범위 없음)는 헤더 포함, A2:L은 헤더 제외.
          return { values: range.includes("!") ? [ROW] : [HEADER, ROW] };
        }),
      });
    }
    if (method === "POST" && url.includes("/values:batchUpdate")) return Response.json({});
    throw new Error(`unexpected Sheets request: ${method} ${url}`);
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Sheets 읽기 요청 수", () => {
  it("GET /api/words는 탭 수와 무관하게 읽기 2회 — 설정도 같은 batchGet에서 얻는다", async () => {
    const calls = stubSheets();
    const res = await worker.fetch(makeRequest("/api/words", { Authorization: "Bearer pw-zh" }), env);
    const body = (await res.json()) as { words: { tab: string }[]; settings: { sessionLimit: number } };
    expect(res.status).toBe(200);
    expect(body.words.map((word) => word.tab)).toEqual(["1과", "2과", "3과"]);
    expect(body.settings).toEqual({ sessionLimit: 30 });
    expect(calls).toHaveLength(2);
  });

  it("POST /api/answer는 읽기 2회 + 쓰기 1회", async () => {
    const calls = stubSheets();
    const res = await worker.fetch(
      makeRequest(
        "/api/answer",
        { Authorization: "Bearer pw-zh", "content-type": "application/json" },
        {
          method: "POST",
          body: JSON.stringify({ tab: "2과", hanzi: "经济", mode: "m1", timestamp: "2026-11-16 23:00", isReview: false }),
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tab: "2과", hanzi: "经济", m1: 2 });
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(2);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });
});
