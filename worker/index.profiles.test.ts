import { describe, expect, it } from "vitest";
import worker from "./index.ts";

// PROFILES 2프로필 구성의 비밀번호 → 프로필 해석 스위트 (#71, PRD-general §6).
// getProfiles·다이제스트 캐시가 isolate 수명 동안 첫 성공 구성을 고정하므로 모든
// 테스트가 동일한 PROFILES 값을 사용해야 한다. 다른 구성(폴백·설정 오류)은 파일
// 분리로 격리한다: index.test.ts, index.config-error.test.ts.
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

const env = {
  PROFILES: JSON.stringify(PROFILES),
  CF_VERSION_METADATA: { id: "v-test", tag: "", timestamp: "" },
} as unknown as Env;

// new Request()는 Request<unknown, CfProperties>를 만들지만 핸들러는 수신 요청 타입
// (IncomingRequestCfProperties)을 기대한다 — 테스트에서는 cf를 쓰지 않으므로 캐스트.
type WorkerRequest = Parameters<typeof worker.fetch>[0];

function healthRequest(headers?: Record<string, string>): WorkerRequest {
  return new Request("https://example.com/api/health", { headers }) as WorkerRequest;
}

interface HealthBody {
  ok: boolean;
  profile: { id: string; name: string; modes: string[]; contentType: string };
}

describe("비밀번호 → 프로필 해석 (2프로필)", () => {
  it("1번 프로필 비밀번호는 1번 프로필로 해석된다", async () => {
    const res = await worker.fetch(healthRequest({ Authorization: "Bearer pw-zh" }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.profile).toEqual({
      id: "zh",
      name: "중국어 단어",
      modes: ["m1", "m2"],
      contentType: "zh",
    });
  });

  it("2번 프로필 비밀번호는 2번 프로필로 해석된다", async () => {
    const res = await worker.fetch(healthRequest({ Authorization: "Bearer pw-en" }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.profile).toEqual({
      id: "en",
      name: "영어 표현",
      modes: ["m1"],
      contentType: "generic",
    });
  });

  it("전 프로필 불일치면 401 — 기존 계약 그대로", async () => {
    const res = await worker.fetch(
      healthRequest({ Authorization: "Bearer clearly-wrong-token" }),
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(res.headers.get("X-Worker-Version")).toBe("v-test");
  });

  it("헤더가 없으면 401", async () => {
    const res = await worker.fetch(healthRequest(), env);
    expect(res.status).toBe(401);
  });

  it("응답 본문에 어떤 프로필의 sheetId·비밀번호도 실리지 않는다", async () => {
    const res = await worker.fetch(healthRequest({ Authorization: "Bearer pw-zh" }), env);
    const text = await res.text();
    expect(text).not.toContain("sheet-zh");
    expect(text).not.toContain("sheet-en");
    expect(text).not.toContain("pw-zh");
    expect(text).not.toContain("pw-en");
    expect(text).not.toContain("sheetId");
    expect(text).not.toContain("password");
  });
});
