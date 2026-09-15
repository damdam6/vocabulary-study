import { describe, expect, it } from "vitest";
import { createPronunciationController } from "./speak.ts";
import type { TtsAudioOutput, TtsAudioOutputEvent, TtsAudioResponse, TtsBlobCache, TtsPlayResult, TtsTransport } from "./ttsTypes.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

const response = (revision = "r1"): TtsAudioResponse => ({
  audio: new Blob([revision]), source: "GENERATED", storage: "SAVED", pronunciation: "absent", revision,
});

class AudioDouble implements TtsAudioOutput {
  readonly blobs: Blob[] = [];
  readonly listeners = new Set<(event: TtsAudioOutputEvent) => void>();
  readonly results: ReturnType<typeof deferred<TtsPlayResult>>[] = [];
  stops = 0;
  disposed = 0;

  play(blob: Blob): Promise<TtsPlayResult> {
    this.blobs.push(blob);
    const result = deferred<TtsPlayResult>();
    this.results.push(result);
    return result.promise;
  }
  stop(): void { this.stops += 1; }
  dispose(): void { this.disposed += 1; }
  subscribe(listener: (event: TtsAudioOutputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: TtsAudioOutputEvent): void { for (const listener of [...this.listeners]) listener(event); }
}

class CacheDouble implements TtsBlobCache {
  readonly values = new Map<string, Blob>();
  readonly pins = new Set<string>();
  sets = 0;
  clears = 0;
  disposed = 0;
  store = true;
  get(key: string): Blob | undefined { return this.values.get(key); }
  set(key: string, blob: Blob): { stored: boolean } { this.sets += 1; if (this.store) this.values.set(key, blob); return { stored: this.store }; }
  pin(key: string): void { if (this.values.has(key)) this.pins.add(key); }
  unpin(key: string): void { this.pins.delete(key); }
  clear(): void { this.clears += 1; this.values.clear(); this.pins.clear(); }
  dispose(): void { this.disposed += 1; }
}

function setup(transport?: TtsTransport, enabled = true) {
  const audio = new AudioDouble();
  const cache = new CacheDouble();
  const requests: { input: { text: string; pinyin?: string }; signal: AbortSignal; pending: ReturnType<typeof deferred<TtsAudioResponse>> }[] = [];
  const defaultTransport: TtsTransport = (input, signal) => {
    const pending = deferred<TtsAudioResponse>();
    requests.push({ input, signal, pending });
    return pending.promise;
  };
  const controller = createPronunciationController({
    profileId: "profile", capability: enabled ? { enabled: true, revision: "r1", maxTextLength: 200 } : { enabled: false },
    transport: transport ?? defaultTransport, audio, cache,
  });
  return { controller, audio, cache, requests };
}

const input = { text: "  e\u0301中\r\n文  ", pinyin: " ha\u0301ng\r " };

describe("PronunciationController", () => {
  it("비활성 capability와 유효하지 않은 입력은 요청·재생 없이 안정 snapshot을 제공한다", () => {
    const disabled = setup(undefined, false);
    disabled.controller.activate("q", { text: "中", pinyin: null });
    expect(disabled.controller.getSnapshot()).toMatchObject({ enabled: false, questionId: "q", status: "idle" });
    disabled.controller.reveal("q");
    expect(disabled.requests).toHaveLength(0);

    const { controller, requests } = setup();
    controller.activate("bad", { text: "中".repeat(201), pinyin: null });
    expect(controller.getSnapshot()).toMatchObject({ inputReason: "text_too_long", status: "idle" });
    controller.replay("bad");
    expect(requests).toHaveLength(0);
    const stable = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(stable);
  });

  it("입력을 Worker 계약처럼 정규화하고 pinyin null은 transport에서 생략한다", async () => {
    const { controller, requests } = setup();
    controller.activate("q", input);
    controller.reveal("q");
    expect(requests[0].input).toEqual({ text: "é中\n文", pinyin: "háng" });
    requests[0].pending.resolve(response());
    await Promise.resolve();

    controller.stop("advance");
    controller.activate("next", { text: "中", pinyin: "  " });
    controller.replay("next");
    expect(requests[1].input).toEqual({ text: "中" });
  });

  it("activate만으로는 요청하지 않고 동일 questionId 재활성은 상태와 자동 기회를 보존한다", async () => {
    const { controller, requests, audio } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.activate("q", { text: "다른中", pinyin: null });
    controller.prepare("q");
    controller.prepare("q");
    expect(requests).toHaveLength(1);
    requests[0].pending.resolve(response());
    await Promise.resolve();
    expect(audio.blobs).toHaveLength(0);
    controller.reveal("q");
    controller.reveal("q");
    expect(audio.blobs).toHaveLength(1);
  });

  it("reveal 전 준비 성공은 재생하지 않고 공개 뒤 자동으로 한 번만 재생한다", async () => {
    const { controller, requests, audio } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.prepare("q");
    requests[0].pending.resolve(response());
    await Promise.resolve();
    expect(audio.blobs).toHaveLength(0);
    controller.reveal("q");
    expect(audio.blobs).toHaveLength(1);
    audio.results[0].resolve({ status: "started" });
    await Promise.resolve();
    expect(controller.getSnapshot().status).toBe("playing");
  });

  it("로딩 중 replay는 요청과 manual 의도를 하나로 합치고 자동 재생을 추가하지 않는다", async () => {
    const { controller, requests, audio } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.prepare("q");
    controller.replay("q");
    controller.replay("q");
    controller.reveal("q");
    expect(requests).toHaveLength(1);
    requests[0].pending.resolve(response());
    await Promise.resolve();
    expect(audio.blobs).toHaveLength(1);
  });

  it("공개 전 manual 요청이 먼저 성공해도 reveal에서 한 번만 재생하고 auto를 추가하지 않는다", async () => {
    const { controller, requests, audio } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.replay("q");
    requests[0].pending.resolve(response());
    await Promise.resolve();
    expect(audio.blobs).toHaveLength(0);
    controller.reveal("q");
    controller.reveal("q");
    expect(audio.blobs).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("공개 전 manual 캐시 hit는 reveal에서 한 번만 재생하고 fetch하지 않는다", () => {
    const { controller, requests, cache, audio } = setup();
    const key = JSON.stringify(["profile", "r1", "中", null]);
    const cached = new Blob(["cached"]);
    cache.values.set(key, cached);
    controller.activate("q", { text: "中", pinyin: null });
    controller.replay("q");
    expect(audio.blobs).toHaveLength(0);
    expect(requests).toHaveLength(0);
    controller.reveal("q");
    controller.reveal("q");
    expect(audio.blobs).toEqual([cached]);
    expect(requests).toHaveLength(0);
  });

  it("캐시 hit replay는 반환 전 동기로 Audio를 호출하고 추가 요청하지 않는다", async () => {
    const { controller, requests, cache, audio } = setup();
    const key = JSON.stringify(["profile", "r1", "中", null]);
    const cached = new Blob(["cached"]);
    cache.values.set(key, cached);
    controller.activate("q", { text: "中", pinyin: null });
    controller.reveal("q");
    expect(audio.blobs).toEqual([cached]);
    expect(requests).toHaveLength(0);
    controller.replay("q");
    expect(audio.blobs).toEqual([cached, cached]);
    expect(requests).toHaveLength(0);
  });

  it("자동 실패는 조용히 끝나며 manual 재시도만 새 요청과 고정 안내를 만든다", async () => {
    const { controller, requests } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.reveal("q");
    requests[0].pending.reject({ kind: "network" });
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ status: "error", message: null });
    controller.reveal("q");
    expect(requests).toHaveLength(1);
    controller.replay("q");
    expect(requests).toHaveLength(2);
    requests[1].pending.reject({ kind: "timeout" });
    await Promise.resolve();
    expect(controller.getSnapshot().message).toBe("발음을 불러오지 못했어요. 다시 눌러 주세요.");
  });

  it("차단된 Blob은 유지하고 다음 manual replay는 fetch 없이 시작한다", async () => {
    const { controller, requests, audio } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.reveal("q");
    requests[0].pending.resolve(response());
    await Promise.resolve();
    audio.results[0].resolve({ status: "blocked" });
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ status: "blocked", message: null });
    controller.replay("q");
    expect(audio.blobs).toHaveLength(2);
    expect(requests).toHaveLength(1);
  });

  it("늦은 A 응답·실패·revision은 B의 상태와 캐시를 바꾸지 않는다", async () => {
    const { controller, requests, cache, audio } = setup();
    controller.activate("a", { text: "甲", pinyin: null });
    controller.reveal("a");
    controller.activate("b", { text: "乙", pinyin: null });
    controller.reveal("b");
    expect(requests[0].signal.aborted).toBe(true);
    requests[1].pending.resolve(response("r1"));
    await Promise.resolve();
    expect(audio.blobs).toHaveLength(1);
    const before = controller.getSnapshot();
    const beforeClears = cache.clears;
    requests[0].pending.resolve(response("stale"));
    await Promise.resolve();
    expect(controller.getSnapshot()).toBe(before);
    expect(cache.clears).toBe(beforeClears);
  });

  it("현재 revision만 cache를 비우고 stored:false Blob도 현재 재생에 보존한다", async () => {
    const { controller, requests, cache, audio } = setup();
    cache.store = false;
    controller.activate("q", { text: "中", pinyin: null });
    controller.reveal("q");
    requests[0].pending.resolve(response("r2"));
    await Promise.resolve();
    expect(cache.clears).toBe(1);
    expect(audio.blobs).toHaveLength(1);
    controller.replay("q");
    expect(audio.blobs).toHaveLength(2);
    expect(requests).toHaveLength(1);
  });

  it("hidden은 자동 재개를 막고 manual replay만 복귀시키며 advance는 옛 명령을 무시한다", async () => {
    const { controller, requests, audio } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.reveal("q");
    controller.stop("hidden");
    expect(requests[0].signal.aborted).toBe(true);
    controller.activate("q", { text: "中", pinyin: null });
    controller.prepare("q");
    controller.reveal("q");
    expect(requests).toHaveLength(1);
    controller.replay("q");
    expect(requests).toHaveLength(2);
    requests[1].pending.resolve(response());
    await Promise.resolve();
    expect(audio.blobs).toHaveLength(1);
    controller.stop("advance");
    controller.replay("q");
    expect(requests).toHaveLength(2);
  });

  it("오래된 play 결과·이벤트와 구독자 재진입은 현재 상태를 되돌리지 않는다", async () => {
    const { controller, requests, audio } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.reveal("q");
    requests[0].pending.resolve(response());
    await Promise.resolve();
    controller.replay("q");
    audio.results[0].resolve({ status: "started" });
    await Promise.resolve();
    expect(controller.getSnapshot().status).toBe("loading");
    audio.results[1].resolve({ status: "started" });
    await Promise.resolve();
    audio.emit("ended");
    expect(controller.getSnapshot().status).toBe("ready");
    const unsubscribe = controller.subscribe(() => controller.stop("advance"));
    controller.replay("q");
    unsubscribe();
    expect(controller.getSnapshot().questionId).toBeNull();
  });

  it("disabled 응답은 세션을 latch하고 dispose는 포트와 구독을 한 번만 정리한다", async () => {
    const { controller, requests, audio, cache } = setup();
    controller.activate("q", { text: "中", pinyin: null });
    controller.replay("q");
    requests[0].pending.reject({ kind: "http", status: 503, error: "tts_disabled", message: "ignored" });
    await Promise.resolve();
    expect(controller.getSnapshot().enabled).toBe(false);
    controller.activate("next", { text: "中", pinyin: null });
    controller.replay("next");
    expect(requests).toHaveLength(1);
    controller.dispose();
    controller.dispose();
    expect(audio.disposed).toBe(1);
    expect(cache.disposed).toBe(1);
  });
});
