import { afterEach, describe, expect, it, vi } from "vitest";

// 실제 RSA 서명 없이 라우트를 테스트하기 위해 토큰 발급 자체를 모킹한다 —
// sheets.ts가 이 모듈의 getAccessToken을 그대로 가져다 쓴다.
vi.mock("./lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));

import worker from "./index.ts";
import { makeEnv, makeRequest } from "./test-utils.ts";

// 프로필 간 시트 격리 스위트 (#73, PRD-general §6) — "모든 Sheets 호출 경로가 인증된
// 프로필의 sheetId만 쓰는가"를 mock fetch URL 전수 기록으로 직접 검증한다.
// getProfiles·다이제스트 캐시가 isolate 수명 동안 첫 성공 구성을 고정하므로 모든
// 테스트가 동일한 PROFILES 값을 사용해야 한다. 다른 구성(폴백·해석·설정 오류)은
// 파일 분리로 격리한다: index.test.ts, index.profiles.test.ts, index.config-error.test.ts.
const PROFILES = [
  {
    id: "zh",
    name: "중국어 단어",
    password: "pw-zh",
    sheetId: "sheet-zh",
    modes: ["m1", "m2"],
    contentType: "zh",
  },
  {
    id: "en",
    name: "영어 표현",
    password: "pw-en",
    sheetId: "sheet-en",
    modes: ["m1"],
    contentType: "generic",
  },
];

const env = makeEnv({ PROFILES: JSON.stringify(PROFILES) });

interface SheetState {
  titles: string[];
  rows: Record<string, string[][]>;
}

// sheetId별 시트 상태 — words/tabs가 실제로 쓰는 요청(탭 제목 조회, A2:F 읽기)만 지원한다.
const SHEETS: Record<string, SheetState> = {
  "sheet-zh": {
    titles: ["HSK6급", "_메모"],
    rows: { HSK6급: [["经济", "jīngjì", "경제", "1", "2", "2026-07-30|3"]] },
  },
  "sheet-en": {
    titles: ["표현"],
    rows: { 표현: [["look up", "", "찾아보다"]] },
  },
};

/** Sheets API 호출을 가로채 URL의 sheetId별 상태로 응답하고, 호출된 URL 전부를 기록한다. */
function stubSheetsFetch(): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = input.toString();
      urls.push(url);
      const sheetId = url.match(/\/spreadsheets\/([^/?]+)/)?.[1] ?? "";
      const sheet = SHEETS[sheetId];
      if (!sheet) {
        return new Response("sheet not found", { status: 404 });
      }
      if (url.includes("?fields=")) {
        return Response.json({ sheets: sheet.titles.map((title) => ({ properties: { title } })) });
      }
      const decoded = decodeURIComponent(url.split("/values/")[1].split("?")[0]);
      const tab = decoded.slice(1, decoded.indexOf("!") - 1);
      return Response.json({ values: sheet.rows[tab] ?? [] });
    }),
  );
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("프로필별 시트 격리 — GET /api/words", () => {
  it("프로필 A 비밀번호 요청은 A의 sheetId로만 Sheets API를 호출한다", async () => {
    const { urls } = stubSheetsFetch();
    const res = await worker.fetch(makeRequest("/api/words", { Authorization: "Bearer pw-zh" }), env);
    expect(res.status).toBe(200);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain("/spreadsheets/sheet-zh");
      expect(url).not.toContain("sheet-en");
    }
  });

  it("프로필 2개 구성에서 각자 시트의 단어를 반환한다", async () => {
    stubSheetsFetch();

    const resZh = await worker.fetch(makeRequest("/api/words", { Authorization: "Bearer pw-zh" }), env);
    const zh = (await resZh.json()) as { words: unknown[] };
    // words 항목 형태 불변(§7.3 계약) — _메모 탭은 학습 대상에서 제외된다.
    expect(zh.words).toEqual([
      {
        tab: "HSK6급",
        hanzi: "经济",
        pinyin: "jīngjì",
        meaning: "경제",
        m1: 1,
        m2: 2,
        nextReview: "2026-07-30",
        interval: 3,
      },
    ]);

    const resEn = await worker.fetch(makeRequest("/api/words", { Authorization: "Bearer pw-en" }), env);
    const en = (await resEn.json()) as { words: unknown[] };
    expect(en.words).toEqual([
      {
        tab: "표현",
        hanzi: "look up",
        pinyin: "",
        meaning: "찾아보다",
        m1: 0,
        m2: 0,
        nextReview: null,
        interval: null,
      },
    ]);
  });

  it("응답 최상위 profile 블록은 공개 필드만 담고 sheetId·비밀번호는 싣지 않는다", async () => {
    stubSheetsFetch();
    const res = await worker.fetch(makeRequest("/api/words", { Authorization: "Bearer pw-en" }), env);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { fetchedAt: unknown; profile: unknown };
    expect(body.profile).toEqual({
      id: "en",
      name: "영어 표현",
      modes: ["m1"],
      contentType: "generic",
    });
    expect(typeof body.fetchedAt).toBe("string");
    expect(text).not.toContain("sheet-zh");
    expect(text).not.toContain("sheet-en");
    expect(text).not.toContain("pw-zh");
    expect(text).not.toContain("pw-en");
    expect(text).not.toContain("sheetId");
    expect(text).not.toContain("password");
  });
});

describe("프로필별 시트 격리 — GET /api/tabs", () => {
  it("프로필별로 각자 시트의 탭 목록(_ 접두 제외)을 반환하고 URL도 격리된다", async () => {
    const { urls } = stubSheetsFetch();

    const resZh = await worker.fetch(makeRequest("/api/tabs", { Authorization: "Bearer pw-zh" }), env);
    expect((await resZh.json()) as object).toEqual({ tabs: ["HSK6급"] });
    for (const url of urls) {
      expect(url).toContain("/spreadsheets/sheet-zh");
    }

    urls.length = 0;
    const resEn = await worker.fetch(makeRequest("/api/tabs", { Authorization: "Bearer pw-en" }), env);
    expect((await resEn.json()) as object).toEqual({ tabs: ["표현"] });
    for (const url of urls) {
      expect(url).toContain("/spreadsheets/sheet-en");
    }
  });
});
