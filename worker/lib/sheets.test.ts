import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import { makeEnv } from "../test-utils.ts";
import { appendValues, getValues, SheetsApiError } from "./sheets.ts";

// sheetsFetch 재시도 계약: 429는 항상, 5xx는 읽기(GET)만 재시도하고 그 외는 즉시 실패한다.
describe("sheetsFetch — 재시도", () => {
  const env = makeEnv();
  const ok = () => Response.json({ values: [["a"]] });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("429 뒤 성공하면 결과를 돌려준다", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const result = getValues(env, "sheet-x", "탭", "A:B");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual([["a"]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("읽기의 5xx도 재시도한다", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const result = getValues(env, "sheet-x", "탭", "A:B");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual([["a"]]);
  });

  it("계속 429면 3회 시도 후 상태를 담아 던지고 로그에 남긴다", async () => {
    const fetchMock = vi.fn(async () => new Response("quota", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = getValues(env, "sheet-x", "탭", "A:B");
    const assertion = expect(result).rejects.toMatchObject({ name: "SheetsApiError", status: 429 });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("failed: 429 quota"));
  });

  it("쓰기의 5xx는 중복 반영 위험이 있어 재시도하지 않는다", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(appendValues(env, "sheet-x", "탭", "A:B", [["x"]])).rejects.toBeInstanceOf(SheetsApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("4xx(429 제외)는 재시도하지 않는다", async () => {
    const fetchMock = vi.fn(async () => new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getValues(env, "sheet-x", "탭", "A:B")).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
