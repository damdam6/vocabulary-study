/**
 * 워커 통합 테스트 공용 헬퍼. 모듈 스코프 상태가 없는 순수 헬퍼만 둔다 — 프로필
 * 구성 시나리오별 격리는 여전히 "테스트 파일 = isolate" 규약이 담당한다
 * (index.test.ts 단일 프로필 · index.profiles.test.ts 2프로필 · index.config-error.test.ts 오류).
 */

import worker from "./index.ts";

// new Request()는 Request<unknown, CfProperties>를 만들지만 핸들러는 수신 요청 타입
// (IncomingRequestCfProperties)을 기대한다 — 테스트에서는 cf를 쓰지 않으므로 캐스트.
export type WorkerRequest = Parameters<typeof worker.fetch>[0];

export function makeRequest(
  path: string,
  headers?: Record<string, string>,
  init: Omit<RequestInit, "headers"> = {},
): WorkerRequest {
  return new Request(`https://example.com${path}`, { ...init, headers }) as WorkerRequest;
}

export function healthRequest(headers?: Record<string, string>): WorkerRequest {
  return makeRequest("/api/health", headers);
}

/**
 * 테스트 env 팩토리 — 워커가 실제로 읽는 필드만 담고, `Env`로의 단언은 이 한곳에서만
 * 한다. 생성 타입 `Env`는 `GOOGLE_SERVICE_ACCOUNT_KEY`·`ASSETS`(Fetcher) 등 테스트
 * 더블로 충족할 수 없거나 모킹으로 우회하는 필드를 요구하므로 단언 없는 완전한 타입
 * 충족은 불가능하고, 설정 오류 스위트는 필드가 빠진 env를 의도적으로 만들어야 한다.
 * `CF_VERSION_METADATA`는 기본 제공 — 무버전 시나리오는 `CF_VERSION_METADATA:
 * undefined`로 덮어쓴다.
 */
export function makeEnv(vars: Record<string, unknown> = {}): Env {
  return {
    CF_VERSION_METADATA: { id: "v-test", tag: "", timestamp: "" },
    ...vars,
  } as unknown as Env;
}

/** waitUntil에 넘긴 작업을 테스트에서 명시적으로 회수한다. */
export function makeExecutionContext(): ExecutionContext & { readonly tasks: Promise<unknown>[]; drain(): Promise<void> } {
  const tasks: Promise<unknown>[] = [];
  return {
    tasks,
    waitUntil(task: Promise<unknown>) { tasks.push(task); },
    passThroughOnException() {},
    async drain() {
      const settled = await Promise.allSettled(tasks);
      const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (rejected) throw rejected.reason;
    },
  } as ExecutionContext & { readonly tasks: Promise<unknown>[]; drain(): Promise<void> };
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Sheets `values:batchGet` 요청을 범위별 `values.get` 호출로 풀어 기존 단일 범위 목에 위임한다.
 * 탭 전체 범위(`'탭'`)는 목이 다루기 쉽게 `'탭'!A1:ZZZ`로 바꿔 넘긴다(1행 헤더 포함).
 * 하나라도 실패하면 그 응답을 그대로 돌려준다 — 실제 batchGet도 범위 하나가 잘못되면 전체가 실패한다.
 */
export function expandBatchGet<T extends FetchLike>(inner: T): T {
  const wrapped: FetchLike = async (input, init) => {
    const url = input.toString();
    const marker = "/values:batchGet?";
    const at = url.indexOf(marker);
    if (at === -1) return inner(input, init);
    const base = url.slice(0, at);
    const valueRanges: { values: string[][] }[] = [];
    for (const encoded of new URLSearchParams(url.slice(at + marker.length)).getAll("ranges")) {
      const range = /^'(?:''|[^'])*'$/.test(encoded) ? `${encoded}!A1:ZZZ` : encoded;
      const res = await inner(`${base}/values/${encodeURIComponent(range)}`, init);
      if (!res.ok) return res;
      valueRanges.push({ values: ((await res.json()) as { values?: string[][] }).values ?? [] });
    }
    return Response.json({ valueRanges });
  };
  return wrapped as T;
}
