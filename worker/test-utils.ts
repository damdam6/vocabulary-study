/**
 * 워커 통합 테스트 공용 헬퍼. 모듈 스코프 상태가 없는 순수 헬퍼만 둔다 — 프로필
 * 구성 시나리오별 격리는 여전히 "테스트 파일 = isolate" 규약이 담당한다
 * (index.test.ts 폴백 · index.profiles.test.ts 2프로필 · index.config-error.test.ts 오류).
 */

import worker from "./index.ts";

// new Request()는 Request<unknown, CfProperties>를 만들지만 핸들러는 수신 요청 타입
// (IncomingRequestCfProperties)을 기대한다 — 테스트에서는 cf를 쓰지 않으므로 캐스트.
export type WorkerRequest = Parameters<typeof worker.fetch>[0];

export function makeRequest(path: string, headers?: Record<string, string>): WorkerRequest {
  return new Request(`https://example.com${path}`, { headers }) as WorkerRequest;
}

export function healthRequest(headers?: Record<string, string>): WorkerRequest {
  return makeRequest("/api/health", headers);
}

/**
 * 테스트 env 팩토리 — 워커가 실제로 읽는 필드만 담고, `Env`로의 단언은 이 한곳에서만
 * 한다. 생성 타입 `Env`는 `SHEET_ID` 리터럴 타입·`ASSETS`(Fetcher) 등 테스트 더블로
 * 충족할 수 없는 필드를 요구하므로 단언 없는 완전한 타입 충족은 불가능하고, 설정
 * 오류 스위트는 필드가 빠진 env를 의도적으로 만들어야 한다. `CF_VERSION_METADATA`는
 * 기본 제공 — 무버전 시나리오는 `CF_VERSION_METADATA: undefined`로 덮어쓴다.
 */
export function makeEnv(vars: Record<string, unknown> = {}): Env {
  return {
    CF_VERSION_METADATA: { id: "v-test", tag: "", timestamp: "" },
    ...vars,
  } as unknown as Env;
}
