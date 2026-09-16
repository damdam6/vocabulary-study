import { describe, expect, it } from "vitest";
import { createTtsAudioOutput, type TtsAudioElement } from "./ttsAudio.ts";
import { createTtsBlobCache } from "./ttsBlobCache.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeAudio implements TtsAudioElement {
  currentTime = -1;
  ended = false;
  error: unknown = null;
  readonly calls: string[] = [];
  readonly attributes = new Map<string, string>();
  readonly callbacks = new Map<"ended" | "error", Set<() => void>>([
    ["ended", new Set()], ["error", new Set()],
  ]);
  readonly added = { ended: [] as (() => void)[], error: [] as (() => void)[] };
  nextPlay = deferred<void>();

  play(): Promise<void> {
    this.calls.push("play");
    return this.nextPlay.promise;
  }

  pause(): void { this.calls.push("pause"); }
  load(): void { this.calls.push("load"); }
  removeAttribute(name: string): void { this.calls.push(`remove:${name}`); this.attributes.delete(name); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.calls.push(`set:${name}`); this.attributes.set(name, value); }
  addEventListener(type: "ended" | "error", callback: () => void): void {
    this.callbacks.get(type)?.add(callback);
    this.added[type].push(callback);
  }
  removeEventListener(type: "ended" | "error", callback: () => void): void { this.callbacks.get(type)?.delete(callback); }

  emitEnded(): void {
    this.ended = true;
    for (const callback of [...(this.callbacks.get("ended") ?? [])]) callback();
  }

  emitError(error: unknown): void {
    this.error = error;
    for (const callback of [...(this.callbacks.get("error") ?? [])]) callback();
  }
}

function outputWith(fake: FakeAudio, urls: string[] = []): ReturnType<typeof createTtsAudioOutput> {
  let sequence = 0;
  return createTtsAudioOutput({
    createAudio: () => fake,
    createObjectURL: () => `blob:test-${++sequence}`,
    revokeObjectURL: (url) => urls.push(url),
  });
}

describe("TtsAudioOutput", () => {
  it("반환 전에 native play를 동기로 시작하고, 같은 Blob도 처음부터 다시 재생한다", async () => {
    const fake = new FakeAudio();
    const revoked: string[] = [];
    const output = outputWith(fake, revoked);
    const blob = new Blob(["audio"]);

    const first = output.play(blob);
    expect(fake.calls).toEqual(["set:src", "play"]);
    fake.nextPlay.resolve();
    await expect(first).resolves.toEqual({ status: "started" });

    fake.ended = false;
    fake.nextPlay = deferred<void>();
    const second = output.play(blob);
    expect(fake.calls).toEqual(["set:src", "play", "pause", "remove:src", "load", "set:src", "play"]);
    expect(revoked).toEqual(["blob:test-1"]);
    fake.nextPlay.resolve();
    await expect(second).resolves.toEqual({ status: "started" });
  });

  it("재생 중 같은 Blob을 5회 눌러도 이전 source를 멈추고 하나씩 처음부터 재생한다", async () => {
    const fake = new FakeAudio();
    const revoked: string[] = [];
    const output = outputWith(fake, revoked);
    const blob = new Blob(["audio"]);

    for (let i = 0; i < 5; i++) {
      fake.ended = false;
      fake.nextPlay = deferred<void>();
      const playing = output.play(blob);
      expect(fake.calls.at(-1)).toBe("play");
      fake.nextPlay.resolve();
      await expect(playing).resolves.toEqual({ status: "started" });
    }

    expect(fake.calls.filter((call) => call === "play")).toHaveLength(5);
    expect(fake.calls.filter((call) => call === "pause")).toHaveLength(4);
    expect(revoked).toEqual(["blob:test-1", "blob:test-2", "blob:test-3", "blob:test-4"]);
  });

  it("교체·stop·dispose 뒤 늦은 native 완료와 이전 listener를 현재 source에서 격리한다", async () => {
    const fake = new FakeAudio();
    const revoked: string[] = [];
    const output = outputWith(fake, revoked);
    const firstDeferred = fake.nextPlay;
    const first = output.play(new Blob(["a"]));
    const firstEndedListener = fake.added.ended[0];

    fake.nextPlay = deferred<void>();
    const second = output.play(new Blob(["b"]));
    firstDeferred.reject(new DOMException("blocked", "NotAllowedError"));
    firstEndedListener();
    await expect(first).resolves.toEqual({ status: "cancelled" });
    expect(revoked).toEqual(["blob:test-1"]);

    fake.nextPlay.resolve();
    await expect(second).resolves.toEqual({ status: "started" });
    expect(fake.getAttribute("src")).toBe("blob:test-2");
    output.stop();
    expect(revoked).toEqual(["blob:test-1", "blob:test-2"]);

    fake.nextPlay = deferred<void>();
    const third = output.play(new Blob(["c"]));
    output.dispose();
    fake.nextPlay.resolve();
    await expect(third).resolves.toEqual({ status: "cancelled" });
    await expect(output.play(new Blob(["d"]))).resolves.toEqual({ status: "cancelled" });
    expect(revoked).toEqual(["blob:test-1", "blob:test-2", "blob:test-3"]);
  });

  it("차단과 시작 전 오류를 결과로 반환하고, 시작 뒤 media 오류만 구독자에게 전달한다", async () => {
    const fake = new FakeAudio();
    const revoked: string[] = [];
    const output = outputWith(fake, revoked);
    const events: string[] = [];
    output.subscribe((event) => events.push(event));

    const blocked = output.play(new Blob(["a"]));
    fake.nextPlay.reject(new DOMException("gesture", "NotAllowedError"));
    await expect(blocked).resolves.toEqual({ status: "blocked" });
    expect(revoked).toEqual(["blob:test-1"]);

    fake.nextPlay = deferred<void>();
    const startError = output.play(new Blob(["b"]));
    const error = new Error("decode");
    fake.emitError(error);
    await expect(startError).resolves.toEqual({ status: "error", error });
    expect(events).toEqual([]);

    fake.nextPlay = deferred<void>();
    const started = output.play(new Blob(["c"]));
    fake.nextPlay.resolve();
    await expect(started).resolves.toEqual({ status: "started" });
    fake.emitError(new Error("network"));
    expect(events).toEqual(["error"]);
    expect(revoked).toEqual(["blob:test-1", "blob:test-2", "blob:test-3"]);
  });

  it("ended 정리 뒤 구독자의 재진입 재생은 새 URL을 보존한다", async () => {
    const fake = new FakeAudio();
    const revoked: string[] = [];
    const output = outputWith(fake, revoked);
    const first = output.play(new Blob(["a"]));
    fake.nextPlay.resolve();
    await first;

    let replay: Promise<unknown> | undefined;
    output.subscribe((event) => {
      if (event === "ended") {
        fake.ended = false;
        fake.nextPlay = deferred<void>();
        replay = output.play(new Blob(["b"]));
      }
    });
    fake.emitEnded();
    expect(revoked).toEqual(["blob:test-1"]);
    expect(fake.getAttribute("src")).toBe("blob:test-2");
    fake.nextPlay.resolve();
    await expect(replay).resolves.toEqual({ status: "started" });
  });

  it("Audio 정리는 Blob cache의 보관 수명과 독립적이다", async () => {
    const fake = new FakeAudio();
    const output = outputWith(fake);
    const cache = createTtsBlobCache();
    const blob = new Blob(["kept"]);
    expect(cache.set("word", blob)).toEqual({ stored: true });

    const play = output.play(cache.get("word")!);
    fake.nextPlay.reject(new DOMException("gesture", "NotAllowedError"));
    await expect(play).resolves.toEqual({ status: "blocked" });
    output.stop();
    expect(cache.get("word")).toBe(blob);
    output.dispose();
    expect(cache.get("word")).toBe(blob);
  });
});
