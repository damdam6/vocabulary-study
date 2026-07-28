import { afterEach, describe, expect, it, vi } from "vitest";

// 실제 RSA 서명 없이 시트 읽기 경로를 테스트하기 위해 토큰 발급을 모킹한다 —
// sheets.ts가 이 모듈의 getAccessToken을 그대로 가져다 쓴다 (index.sheet-isolation.test.ts와 동일 패턴).
vi.mock("./google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import { makeEnv } from "../test-utils.ts";
import {
  DEFAULT_SESSION_LIMIT,
  parseSettings,
  readSettings,
  SESSION_LIMIT_KEY,
  SETTINGS_RANGE,
  SETTINGS_TAB,
} from "./settings.ts";

// '_정보' 탭 파서 — 플랜 docs/plans/session-limit-and-home-utils.md §3.1(읽기는 관대).
// 여기서 검증하는 계약: 행 위치 자유 · 모르는 키 무시 · 이상값은 전부 기본 60 폴백.

describe("parseSettings — 정상 값 채택", () => {
  it("'문제수' 행의 B열을 세션 상한으로 읽는다", () => {
    expect(parseSettings([[SESSION_LIMIT_KEY, "30"]])).toEqual({ sessionLimit: 30 });
  });

  it("키의 행 위치는 자유다 — 앞에 다른 행이 있어도 찾는다", () => {
    const rows = [
      ["메모", "이 탭은 학습 대상이 아님"],
      ["버전", "2"],
      [SESSION_LIMIT_KEY, "25"],
    ];
    expect(parseSettings(rows)).toEqual({ sessionLimit: 25 });
  });

  it("인식하지 않는 키는 무시한다 (전방 호환)", () => {
    const rows = [
      ["나중에추가될설정", "무엇이든"],
      [SESSION_LIMIT_KEY, "40"],
      ["또다른키", ""],
    ];
    expect(parseSettings(rows)).toEqual({ sessionLimit: 40 });
  });

  it("키·값의 앞뒤 공백을 트림한다", () => {
    expect(parseSettings([[` ${SESSION_LIMIT_KEY} `, " 30 "]])).toEqual({ sessionLimit: 30 });
  });

  it("허용 범위 경계 1·500은 채택한다", () => {
    expect(parseSettings([[SESSION_LIMIT_KEY, "1"]])).toEqual({ sessionLimit: 1 });
    expect(parseSettings([[SESSION_LIMIT_KEY, "500"]])).toEqual({ sessionLimit: 500 });
  });

  it("같은 키가 여러 행이면 첫 행이 이긴다", () => {
    const rows = [
      [SESSION_LIMIT_KEY, "30"],
      [SESSION_LIMIT_KEY, "300"],
    ];
    expect(parseSettings(rows)).toEqual({ sessionLimit: 30 });
  });
});

describe("parseSettings — 이상 입력은 기본 60으로 폴백", () => {
  const fallback = { sessionLimit: DEFAULT_SESSION_LIMIT };

  it("탭이 없거나 비어 있으면(빈 배열) 기본값", () => {
    expect(parseSettings([])).toEqual(fallback);
  });

  it("'문제수' 키가 없으면 기본값", () => {
    expect(parseSettings([["메모", "30"]])).toEqual(fallback);
  });

  it("A열이 부분 일치일 뿐이면(다른 키) 기본값", () => {
    expect(parseSettings([["문제수제한", "30"]])).toEqual(fallback);
  });

  it("B열이 비었거나 아예 없는 행(뒤쪽 빈 셀 생략)이면 기본값", () => {
    expect(parseSettings([[SESSION_LIMIT_KEY, ""]])).toEqual(fallback);
    expect(parseSettings([[SESSION_LIMIT_KEY]])).toEqual(fallback);
  });

  it("비정수 값은 기본값", () => {
    expect(parseSettings([[SESSION_LIMIT_KEY, "삼십"]])).toEqual(fallback);
    expect(parseSettings([[SESSION_LIMIT_KEY, "30.5"]])).toEqual(fallback);
    expect(parseSettings([[SESSION_LIMIT_KEY, "30개"]])).toEqual(fallback);
    // Number()만으로 판정하면 통과해버리는 표기들
    expect(parseSettings([[SESSION_LIMIT_KEY, "1e2"]])).toEqual(fallback);
    expect(parseSettings([[SESSION_LIMIT_KEY, "0x1E"]])).toEqual(fallback);
  });

  it("범위 밖 값(0·501·음수)은 기본값", () => {
    expect(parseSettings([[SESSION_LIMIT_KEY, "0"]])).toEqual(fallback);
    expect(parseSettings([[SESSION_LIMIT_KEY, "501"]])).toEqual(fallback);
    expect(parseSettings([[SESSION_LIMIT_KEY, "-5"]])).toEqual(fallback);
  });
});

// readSettings는 시트 1회 읽기 + 전 예외 흡수만 담당한다 — 값 해석은 위 파서 스위트가 덮는다.
describe("readSettings — 시트 읽기와 실패 흡수", () => {
  const env = makeEnv();
  const fallback = { sessionLimit: DEFAULT_SESSION_LIMIT };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'_정보' 탭 A:B를 대상 sheetId로 1회 읽는다", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        urls.push(input.toString());
        return Response.json({ values: [[SESSION_LIMIT_KEY, "30"]] });
      }),
    );

    await expect(readSettings(env, "sheet-x")).resolves.toEqual({ sessionLimit: 30 });

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/spreadsheets/sheet-x");
    expect(decodeURIComponent(urls[0])).toContain(`'${SETTINGS_TAB}'!${SETTINGS_RANGE}`);
  });

  it("탭이 없어 400이 나도 던지지 않고 기본값을 준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unable to parse range", { status: 400 })));
    await expect(readSettings(env, "sheet-x")).resolves.toEqual(fallback);
  });

  it("500 응답도 기본값으로 흡수한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(readSettings(env, "sheet-x")).resolves.toEqual(fallback);
  });

  it("네트워크 오류도 기본값으로 흡수한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(readSettings(env, "sheet-x")).resolves.toEqual(fallback);
  });
});
