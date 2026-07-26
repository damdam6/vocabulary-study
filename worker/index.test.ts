import { describe, expect, it } from "vitest";
import worker from "./index.ts";
import { healthRequest, makeEnv, makeRequest } from "./test-utils.ts";

// 폴백 프로필 경로(#70 — PROFILES 미설정, APP_PASSWORD+SHEET_ID 합성) 스위트.
// 인증 검사가 /api/health 분기보다 앞선다는 순서 고정(#23)도 여기서 유지한다.
// getProfiles·다이제스트 캐시가 isolate 수명 동안 첫 성공 구성을 고정하므로 모든
// 테스트가 동일한 env 값을 사용해야 한다 — 값을 바꾸면 캐시가 오염된다. 다른 구성
// (2프로필·설정 오류)은 파일 분리로 격리한다: index.profiles.test.ts,
// index.config-error.test.ts.
const PASSWORD = "test-password";
const SHEET_ID = "test-sheet-id";

const env = makeEnv({ APP_PASSWORD: PASSWORD, SHEET_ID });

describe("/api/* 인증 게이트", () => {
  it("Authorization 헤더가 없으면 401", async () => {
    const res = await worker.fetch(healthRequest(), env);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("틀린 토큰이면 /api/health도 401 — 인증이 health 분기보다 먼저", async () => {
    const res = await worker.fetch(
      healthRequest({ Authorization: "Bearer clearly-wrong-token" }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("Bearer가 아닌 스킴이면 401", async () => {
    const res = await worker.fetch(
      healthRequest({ Authorization: `Basic ${PASSWORD}` }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("/api/health 외의 /api/* 경로도 게이트를 통과해야 한다", async () => {
    const res = await worker.fetch(
      makeRequest("/api/words", { Authorization: "Bearer clearly-wrong-token" }),
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/health (인증됨 — 폴백 프로필)", () => {
  it("기존 비밀번호로 200 + ok:true + 서빙 버전 노출 — 프로덕션 무중단 전제", async () => {
    const res = await worker.fetch(
      healthRequest({ Authorization: `Bearer ${PASSWORD}` }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Worker-Version")).toBe("v-test");
    const body = (await res.json()) as { ok: boolean; version: string; profile: unknown };
    expect(body.ok).toBe(true);
    expect(body.version).toBe("v-test");
    // 폴백 합성 프로필(#70)이 profile 블록으로 노출된다 (PRD-general §5.2).
    expect(body.profile).toEqual({
      id: "default",
      name: "단어 암기",
      modes: ["m1", "m2"],
      contentType: "zh",
    });
  });

  it("응답 본문에 sheetId·비밀번호가 실리지 않는다", async () => {
    const res = await worker.fetch(
      healthRequest({ Authorization: `Bearer ${PASSWORD}` }),
      env,
    );
    const text = await res.text();
    expect(text).not.toContain(SHEET_ID);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("sheetId");
    expect(text).not.toContain("password");
  });
});

describe("401 응답의 버전 관측성", () => {
  it("401에도 X-Worker-Version 헤더가 실린다 — 스모크 로그로 버전 혼재 관측 가능", async () => {
    const res = await worker.fetch(
      healthRequest({ Authorization: "Bearer clearly-wrong-token" }),
      env,
    );
    expect(res.headers.get("X-Worker-Version")).toBe("v-test");
  });

  it("CF_VERSION_METADATA 바인딩이 없으면 'unknown'으로 폴백", async () => {
    const noVersionEnv = makeEnv({
      APP_PASSWORD: PASSWORD,
      SHEET_ID,
      CF_VERSION_METADATA: undefined,
    });
    const res = await worker.fetch(healthRequest(), noVersionEnv);
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Worker-Version")).toBe("unknown");
  });
});
