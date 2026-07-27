import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProfile, type AnswerRecord, type PublicProfile, type ReviewFailRecord } from "./api";
import {
  RETRY_QUEUE_CHANGED_EVENT,
  RETRY_QUEUE_STORAGE_KEY,
  enqueueAnswer,
  enqueueReviewFail,
  flushRetryQueue,
  getRetryQueueLength,
  type RetryQueueEntry,
} from "./retryQueue";

// vitest는 node 환경이라 localStorage/fetch/window가 없다 — 전역에 스텁을 주입한다.
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

const dispatchEvent = vi.fn();

beforeEach(() => {
  stubLocalStorage();
  dispatchEvent.mockClear();
  vi.stubGlobal("window", { dispatchEvent });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function record(n: number, timestamp = `2026-07-18 09:0${n}`): AnswerRecord {
  return { tab: "HSK6급", hanzi: `字${n}`, mode: "m1", timestamp, isReview: false };
}

function reviewFailRecord(n: number): ReviewFailRecord {
  return { tab: "HSK6급", hanzi: `字${n}` };
}

function answerEntry(n: number, timestamp?: string, profileId?: string): RetryQueueEntry {
  return { kind: "answer", record: record(n, timestamp), ...(profileId !== undefined && { profileId }) };
}

function reviewFailEntry(n: number, profileId?: string): RetryQueueEntry {
  return { kind: "review-fail", record: reviewFailRecord(n), ...(profileId !== undefined && { profileId }) };
}

function seedQueue(entries: RetryQueueEntry[]) {
  localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, JSON.stringify(entries));
}

function storedQueue(): RetryQueueEntry[] {
  return JSON.parse(localStorage.getItem(RETRY_QUEUE_STORAGE_KEY) ?? "[]");
}

function profile(id: string): PublicProfile {
  return { id, name: id, modes: ["m1"], contentType: "generic" };
}

/** 홈/StudyScreen이 로그인 시 저장해 두는 활성 프로필 캐시를 테스트에서 흉내낸다. */
function activateProfile(id: string) {
  saveProfile(profile(id));
}

const UPDATED_WORD = {
  tab: "HSK6급",
  hanzi: "字1",
  pinyin: "zì",
  meaning: "글자",
  m1: 1,
  m2: 0,
  nextReview: null,
  interval: null,
};

describe("enqueueAnswer", () => {
  it("빈 큐에 answer 엔트리로 적재하고 변경 이벤트를 발화한다", () => {
    enqueueAnswer(record(1));

    expect(storedQueue()).toEqual([answerEntry(1)]);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(RETRY_QUEUE_CHANGED_EVENT);
  });

  it("기존 항목 뒤에 순서대로 append한다", () => {
    seedQueue([answerEntry(1)]);

    enqueueAnswer(record(2));

    expect(storedQueue()).toEqual([answerEntry(1), answerEntry(2)]);
  });

  it("파손된 JSON은 빈 큐로 취급하고 새 항목만 남긴다", () => {
    localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, "{broken");

    enqueueAnswer(record(1));

    expect(storedQueue()).toEqual([answerEntry(1)]);
  });

  it("#18 시절 태그 없는 평면 AnswerRecord[]에도 answer 엔트리로 승격시켜 append한다", () => {
    localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, JSON.stringify([record(1)]));

    enqueueAnswer(record(2));

    expect(storedQueue()).toEqual([answerEntry(1), answerEntry(2)]);
  });

  it("활성 프로필이 있으면 적재 시점의 profileId를 태깅한다(#79)", () => {
    activateProfile("a");

    enqueueAnswer(record(1));

    expect(storedQueue()).toEqual([answerEntry(1, undefined, "a")]);
  });
});

describe("enqueueReviewFail", () => {
  it("빈 큐에 review-fail 엔트리로 적재하고 변경 이벤트를 발화한다", () => {
    enqueueReviewFail(reviewFailRecord(1));

    expect(storedQueue()).toEqual([reviewFailEntry(1)]);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(RETRY_QUEUE_CHANGED_EVENT);
  });

  it("answer 엔트리 뒤에 순서대로 append되어 같은 큐를 공유한다", () => {
    seedQueue([answerEntry(1)]);

    enqueueReviewFail(reviewFailRecord(2));

    expect(storedQueue()).toEqual([answerEntry(1), reviewFailEntry(2)]);
  });

  it("활성 프로필이 있으면 적재 시점의 profileId를 태깅한다(#79)", () => {
    activateProfile("b");

    enqueueReviewFail(reviewFailRecord(1));

    expect(storedQueue()).toEqual([reviewFailEntry(1, "b")]);
  });
});

describe("getRetryQueueLength", () => {
  it("저장값이 없으면 0, 배열이 아니면 0, 배열이면 길이를 반환한다", () => {
    expect(getRetryQueueLength()).toBe(0);
    localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, '{"not":"array"}');
    expect(getRetryQueueLength()).toBe(0);
    seedQueue([answerEntry(1), reviewFailEntry(2)]);
    expect(getRetryQueueLength()).toBe(2);
  });

  it("다른 프로필 항목은 세지 않는다 — 홈 인디케이터는 현재 프로필 기준(#79)", () => {
    seedQueue([answerEntry(1, undefined, "a"), answerEntry(2, undefined, "b"), reviewFailEntry(3, "a")]);
    activateProfile("a");

    expect(getRetryQueueLength()).toBe(2);
  });

  it("무태그 레거시 항목은 현재 프로필로 승격되어 카운트된다(#79)", () => {
    seedQueue([answerEntry(1), answerEntry(2, undefined, "other")]);
    activateProfile("a");

    expect(getRetryQueueLength()).toBe(1);
  });
});

describe("flushRetryQueue", () => {
  it("빈 큐면 아무 요청도 보내지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("FIFO로 원본 payload(최초 타임스탬프 포함) 그대로 재전송하고, 성공 항목을 제거한다", async () => {
    seedQueue([answerEntry(1, "2026-07-17 22:10"), answerEntry(2, "2026-07-17 22:11")]);
    // Response body는 1회용이므로 호출마다 새 인스턴스를 만들어야 한다
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(UPDATED_WORD)));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([path, init]) => {
      expect(path).toBe("/api/answer");
      return JSON.parse((init as RequestInit).body as string);
    });
    expect(bodies).toEqual([record(1, "2026-07-17 22:10"), record(2, "2026-07-17 22:11")]);
    expect(storedQueue()).toEqual([]);
    // 제거 2회 각각 변경 이벤트 발화 — 홈 인디케이터가 즉시 갱신된다
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it("review-fail 엔트리는 POST /api/review-fail로 {tab,hanzi} 바디만 재전송한다", async () => {
    seedQueue([reviewFailEntry(1)]);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(UPDATED_WORD)));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/review-fail");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(reviewFailRecord(1));
    expect(storedQueue()).toEqual([]);
  });

  it("answer와 review-fail이 섞인 큐를 적재 순서대로 각자의 엔드포인트로 재전송한다", async () => {
    seedQueue([answerEntry(1), reviewFailEntry(2), answerEntry(3)]);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(UPDATED_WORD)));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/answer",
      "/api/review-fail",
      "/api/answer",
    ]);
    expect(storedQueue()).toEqual([]);
  });

  it("중간 실패 시 중단하고 실패 항목과 잔여를 큐에 유지한다", async () => {
    seedQueue([answerEntry(1), answerEntry(2), answerEntry(3)]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(UPDATED_WORD))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storedQueue()).toEqual([answerEntry(2), answerEntry(3)]);
  });

  it("review-fail 재전송 실패 시에도 실패 항목과 잔여를 큐에 유지한다", async () => {
    seedQueue([answerEntry(1), reviewFailEntry(2), answerEntry(3)]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(UPDATED_WORD))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storedQueue()).toEqual([reviewFailEntry(2), answerEntry(3)]);
  });

  it("네트워크 예외에도 큐를 유지한다", async () => {
    seedQueue([answerEntry(1)]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await flushRetryQueue();

    expect(storedQueue()).toEqual([answerEntry(1)]);
  });

  it("#18 시절 태그 없는 평면 AnswerRecord[]도 정상 파싱해 재전송하고 큐를 비운다", async () => {
    localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, JSON.stringify([record(1), record(2)]));
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(UPDATED_WORD)));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/answer", "/api/answer"]);
    expect(storedQueue()).toEqual([]);
  });

  it("재진입 가드 — 전송 진행 중의 재호출은 no-op이다", async () => {
    seedQueue([answerEntry(1)]);
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = flushRetryQueue();
    await flushRetryQueue(); // 가드에 걸려 즉시 반환 — 추가 fetch 없음
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(Response.json(UPDATED_WORD));
    await first;
    expect(storedQueue()).toEqual([]);
  });

  it("전송 중 새로 적재된 항목은 유실되지 않고 이어서 전송된다", async () => {
    seedQueue([answerEntry(1)]);
    const fetchMock = vi.fn().mockImplementation(() => {
      if (fetchMock.mock.calls.length === 1) {
        enqueueAnswer(record(2)); // 첫 항목 전송 중 학습 화면에서 새 실패분 적재
      }
      return Promise.resolve(Response.json(UPDATED_WORD));
    });
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual(record(2));
    expect(storedQueue()).toEqual([]);
  });
});

describe("flushRetryQueue — 프로필 필터링(#79)", () => {
  it("다른 프로필 소속 항목은 건드리지 않고 보존하며, 현재 프로필 항목만 전송한다", async () => {
    seedQueue([
      answerEntry(1, undefined, "a"),
      answerEntry(2, undefined, "b"),
      answerEntry(3, undefined, "a"),
    ]);
    activateProfile("a");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(UPDATED_WORD)));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toEqual([record(1), record(3)]);
    // b 소속 항목은 원래 위치 그대로 유지 — 그 프로필로 재로그인하면 그때 전송된다
    expect(storedQueue()).toEqual([answerEntry(2, undefined, "b")]);
  });

  it("무태그 레거시 항목은 현재 프로필로 승격되어 flush 대상에 포함된다", async () => {
    seedQueue([answerEntry(1)]);
    activateProfile("a");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(UPDATED_WORD)));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storedQueue()).toEqual([]);
  });

  it("활성 프로필이 없으면 다른 프로필로 태깅된 항목은 건드리지 않는다", async () => {
    seedQueue([answerEntry(1, undefined, "a")]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(storedQueue()).toEqual([answerEntry(1, undefined, "a")]);
  });
});

describe("flushRetryQueue — 실패 분류: 4xx 폐기 vs 네트워크/5xx 중단(#79)", () => {
  it("4xx 응답은 그 항목만 폐기하고 다음 항목을 계속 전송한다", async () => {
    seedQueue([answerEntry(1), answerEntry(2), answerEntry(3)]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(UPDATED_WORD))
      .mockResolvedValueOnce(Response.json(UPDATED_WORD));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(storedQueue()).toEqual([]);
  });

  it("review-fail 4xx 응답도 폐기 후 다음 항목을 계속 전송한다", async () => {
    seedQueue([reviewFailEntry(1), answerEntry(2)]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(Response.json(UPDATED_WORD));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storedQueue()).toEqual([]);
  });

  it("5xx 응답은 4xx와 달리 폐기하지 않고 그 항목과 잔여를 유지한 채 중단한다", async () => {
    seedQueue([answerEntry(1), answerEntry(2)]);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storedQueue()).toEqual([answerEntry(1), answerEntry(2)]);
  });

  it("4xx 폐기와 5xx 중단이 섞이면 4xx만 버리고 5xx에서 멈춘다", async () => {
    seedQueue([answerEntry(1), answerEntry(2), answerEntry(3)]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // 1: 폐기
      .mockResolvedValueOnce(new Response(null, { status: 500 })); // 2: 중단
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storedQueue()).toEqual([answerEntry(2), answerEntry(3)]);
  });
});
