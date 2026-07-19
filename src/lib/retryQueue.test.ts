import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerRecord } from "./api";
import {
  RETRY_QUEUE_CHANGED_EVENT,
  RETRY_QUEUE_STORAGE_KEY,
  enqueueAnswer,
  flushRetryQueue,
  getRetryQueueLength,
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

function seedQueue(records: AnswerRecord[]) {
  localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, JSON.stringify(records));
}

function storedQueue(): AnswerRecord[] {
  return JSON.parse(localStorage.getItem(RETRY_QUEUE_STORAGE_KEY) ?? "[]");
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
  it("빈 큐에 JSON 배열로 적재하고 변경 이벤트를 발화한다", () => {
    enqueueAnswer(record(1));

    expect(storedQueue()).toEqual([record(1)]);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(RETRY_QUEUE_CHANGED_EVENT);
  });

  it("기존 항목 뒤에 순서대로 append한다", () => {
    seedQueue([record(1)]);

    enqueueAnswer(record(2));

    expect(storedQueue()).toEqual([record(1), record(2)]);
  });

  it("파손된 JSON은 빈 큐로 취급하고 새 항목만 남긴다", () => {
    localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, "{broken");

    enqueueAnswer(record(1));

    expect(storedQueue()).toEqual([record(1)]);
  });
});

describe("getRetryQueueLength", () => {
  it("저장값이 없으면 0, 배열이 아니면 0, 배열이면 길이를 반환한다", () => {
    expect(getRetryQueueLength()).toBe(0);
    localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, '{"not":"array"}');
    expect(getRetryQueueLength()).toBe(0);
    seedQueue([record(1), record(2)]);
    expect(getRetryQueueLength()).toBe(2);
  });
});

describe("flushRetryQueue", () => {
  it("빈 큐면 아무 요청도 보내지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("FIFO로 원본 페이로드(최초 타임스탬프 포함) 그대로 재전송하고, 성공 항목을 제거한다", async () => {
    seedQueue([record(1, "2026-07-17 22:10"), record(2, "2026-07-17 22:11")]);
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

  it("중간 실패 시 중단하고 실패 항목과 잔여를 큐에 유지한다", async () => {
    seedQueue([record(1), record(2), record(3)]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(UPDATED_WORD))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await flushRetryQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storedQueue()).toEqual([record(2), record(3)]);
  });

  it("네트워크 예외에도 큐를 유지한다", async () => {
    seedQueue([record(1)]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await flushRetryQueue();

    expect(storedQueue()).toEqual([record(1)]);
  });

  it("재진입 가드 — 전송 진행 중의 재호출은 no-op이다", async () => {
    seedQueue([record(1)]);
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
    seedQueue([record(1)]);
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
