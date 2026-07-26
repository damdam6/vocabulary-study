import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.ts";
import { healthRequest, makeEnv, makeRequest } from "./test-utils.ts";

// 프로필 설정 오류 → /api/* 500 계약 스위트 (#71). getProfiles는 실패를 캐시하지
// 않으므로(매 호출 재파싱·재던짐 — fail closed) 여러 깨진 구성을 한 파일에서 검증할
// 수 있다. 단, 성공하는 구성을 하나라도 넣으면 그 결과가 isolate 캐시에 고정돼 이후
// 테스트가 헛통과한다 — 이 파일에는 정상 구성을 두지 않는다(정상 경로는
// index.test.ts·index.profiles.test.ts).

function spyConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("프로필 설정 오류 → /api/* 500 (401 아님)", () => {
  it("PROFILES가 깨진 JSON이면 토큰이 있어도 500 + console.error", async () => {
    const errorSpy = spyConsoleError();
    const res = await worker.fetch(
      healthRequest({ Authorization: "Bearer any-token" }),
      makeEnv({ PROFILES: "[{broken" }),
    );
    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("검증 실패(중복 id)도 500", async () => {
    spyConsoleError();
    const dup = { id: "zh", name: "n", password: "pw-a", sheetId: "s", modes: ["m1"] };
    const res = await worker.fetch(
      healthRequest({ Authorization: "Bearer any-token" }),
      makeEnv({ PROFILES: JSON.stringify([dup, { ...dup, password: "pw-b" }]) }),
    );
    expect(res.status).toBe(500);
  });

  it("무헤더 요청도 설정 오류가 먼저다 — 401로 위장되지 않는다", async () => {
    // 스모크(#23/#67)의 무헤더 401 프로브가 설정 사고를 즉시 드러내게 하는 순서 고정.
    spyConsoleError();
    const res = await worker.fetch(healthRequest(), makeEnv({ PROFILES: "[{broken" }));
    expect(res.status).toBe(500);
  });

  it("PROFILES 미설정 + 폴백 변수 부재도 500 — #71 이전의 401 계약을 재정의", async () => {
    // 구 isAuthorized는 APP_PASSWORD 미설정을 401로 눌렀다(구 index.test.ts). 이제는
    // 인증 불능이 아니라 설정 오류로 관측한다.
    spyConsoleError();
    const res = await worker.fetch(
      healthRequest({ Authorization: "Bearer any-token" }),
      makeEnv({}),
    );
    expect(res.status).toBe(500);
  });

  it("500에도 X-Worker-Version 헤더가 실린다 — 어떤 버전의 설정 사고인지 관측", async () => {
    spyConsoleError();
    const res = await worker.fetch(healthRequest(), makeEnv({ PROFILES: "[]" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("X-Worker-Version")).toBe("v-test");
  });

  it("/api/health 외의 /api/* 경로도 500", async () => {
    spyConsoleError();
    const res = await worker.fetch(
      makeRequest("/api/words", { Authorization: "Bearer any-token" }),
      makeEnv({ PROFILES: "[{broken" }),
    );
    expect(res.status).toBe(500);
  });

  it("오류 로그에 비밀번호 값이 실리지 않는다 — #70의 메시지 규약이 경로 전체에서 유지", async () => {
    const errorSpy = spyConsoleError();
    await worker.fetch(
      healthRequest(),
      makeEnv({ PROFILES: '[{"password": "super-secret-pw"' }),
    );
    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("super-secret-pw");
  });
});
