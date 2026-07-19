import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";

const PASSWORD = "test-password";
type WorkerRequest = Parameters<typeof worker.fetch>[0];
const env = { APP_PASSWORD: PASSWORD, SHEET_ID: "test-sheet-id" } as unknown as Env;

function stubTitlesFetch(titles: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ sheets: titles.map((title) => ({ properties: { title } })) })),
  );
}

function tabsRequest(headers?: Record<string, string>): WorkerRequest {
  return new Request("https://example.com/api/tabs", { headers }) as WorkerRequest;
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
