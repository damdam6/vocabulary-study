import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "../index.ts";
import { makeEnv } from "../test-utils.ts";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

const TAB = "문장 원본";
const SENTENCE = " 我有2本书。 ";
const env = makeEnv({
  PROFILES: JSON.stringify([{
    id: "zh",
    name: "중국어",
    password: "pw-zh",
    sheetId: "sheet-zh",
    modes: ["m1", "m2"],
    contentType: "zh",
  }]),
});

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/review-fail — 문장 원문 행 식별", () => {
  it("정확한 tab+hanzi 행의 F열만 갱신하고 원문을 응답한다", async () => {
    const writes: { range: string; values: string[][] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if ((init?.method ?? "GET") === "GET") {
        return Response.json({ values: [
          ["我有2本书", "wrong", "wrong", "3", "3", "2026-09-20|7"],
          [SENTENCE, "wǒ yǒu liǎng běn shū.", "나는 책이 두 권 있다.", "3", "3", "2026-09-20|7"],
        ] });
      }
      const body = JSON.parse(init?.body as string) as { values: string[][] };
      writes.push({ range: decodeURIComponent(url.split("/values/")[1].split("?")[0]), values: body.values });
      return Response.json({});
    }));
    const request = new Request("https://example.com/api/review-fail", {
      method: "POST",
      headers: { Authorization: "Bearer pw-zh", "content-type": "application/json" },
      body: JSON.stringify({ tab: TAB, hanzi: SENTENCE }),
    }) as WorkerRequest;

    const response = await worker.fetch(request, env);
    const body = await response.json() as { tab: string; hanzi: string; interval: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ tab: TAB, hanzi: SENTENCE, interval: 3 });
    expect(writes).toHaveLength(1);
    expect(writes[0].range).toBe("'문장 원본'!F3:F3");
    expect(writes[0].values[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}\|3$/);
  });
});
