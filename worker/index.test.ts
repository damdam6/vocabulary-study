import { describe, expect, it } from "vitest";
import worker from "./index.ts";

// 인증 검사가 /api/health 분기보다 앞선다는 순서를 고정하는 회귀 테스트 (#23).
// auth.ts의 isolate 스코프 다이제스트 캐시 때문에 모든 테스트가 동일한
// APP_PASSWORD 값을 사용해야 한다 — 값을 바꾸면 캐시가 오염된다.
const PASSWORD = "test-password";

const env = {
  APP_PASSWORD: PASSWORD,
  CF_VERSION_METADATA: { id: "v-test", tag: "", timestamp: "" },
} as unknown as Env;

// new Request()는 Request<unknown, CfProperties>를 만들지만 핸들러는 수신 요청 타입
// (IncomingRequestCfProperties)을 기대한다 — 테스트에서는 cf를 쓰지 않으므로 캐스트.
type WorkerRequest = Parameters<typeof worker.fetch>[0];

function makeRequest(path: string, headers?: Record<string, string>): WorkerRequest {
  return new Request(`https://example.com${path}`, { headers }) as WorkerRequest;
}

function healthRequest(headers?: Record<string, string>): WorkerRequest {
  return makeRequest("/api/health", headers);
}

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

  it("APP_PASSWORD 미설정이면 올바른 형식의 토큰도 401", async () => {
    const emptyEnv = { CF_VERSION_METADATA: { id: "v-test" } } as unknown as Env;
    const res = await worker.fetch(
      healthRequest({ Authorization: `Bearer ${PASSWORD}` }),
      emptyEnv,
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

describe("GET /api/health (인증됨)", () => {
  it("올바른 토큰이면 200 + ok:true + 서빙 버전 노출", async () => {
    const res = await worker.fetch(
      healthRequest({ Authorization: `Bearer ${PASSWORD}` }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Worker-Version")).toBe("v-test");
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe("v-test");
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
    const noVersionEnv = { APP_PASSWORD: PASSWORD } as unknown as Env;
    const res = await worker.fetch(healthRequest(), noVersionEnv);
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Worker-Version")).toBe("unknown");
  });
});
