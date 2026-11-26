import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  plays = 0;
  play(): Promise<void> {
    this.plays += 1;
    return Promise.resolve();
  }
}

interface FakeNode { connected: unknown[]; disconnected: boolean; connect(target: unknown): void; disconnect(): void }
const node = (extra: object = {}): FakeNode => ({
  connected: [], disconnected: false,
  connect(target) { this.connected.push(target); },
  disconnect() { this.disconnected = true; },
  ...extra,
});
const param = () => ({ value: 0 });

let contexts: FakeContext[] = [];
class FakeContext {
  state = "suspended";
  resumes = 0;
  destination = { destination: true };
  gain = node({ gain: param() }) as FakeNode & { gain: { value: number } };
  limiter = node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  sources: (FakeNode & { element: unknown })[] = [];
  constructor() { contexts.push(this); }
  createGain() { return this.gain; }
  createDynamicsCompressor() { return this.limiter; }
  createMediaElementSource(element: unknown) {
    const source = { ...node(), element };
    this.sources.push(source);
    return source;
  }
  resume() { this.resumes += 1; this.state = "running"; return Promise.resolve(); }
}

async function load() {
  vi.resetModules();
  return import("./ttsVolume.ts");
}

beforeEach(() => {
  contexts = [];
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => vi.unstubAllGlobals());

describe("createBoostedAudio", () => {
  it("falls back to a plain Audio element without Web Audio", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const { createBoostedAudio } = await load();
    const element = createBoostedAudio();
    expect(element).toBeInstanceOf(FakeAudio);
    expect(element.release).toBeUndefined();
  });

  it("routes every element through one shared gain → limiter chain", async () => {
    vi.stubGlobal("AudioContext", FakeContext);
    const { createBoostedAudio, TTS_PLAYBACK_GAIN } = await load();
    const first = createBoostedAudio();
    const second = createBoostedAudio();

    expect(contexts).toHaveLength(1);
    const [context] = contexts;
    expect(TTS_PLAYBACK_GAIN).toBeGreaterThan(1);
    expect(context.gain.gain.value).toBe(TTS_PLAYBACK_GAIN);
    expect(context.gain.connected).toEqual([context.limiter]);
    expect(context.limiter.connected).toEqual([context.destination]);
    expect(context.sources.map((source) => source.element)).toEqual([first, second]);
    expect(context.sources.every((source) => source.connected[0] === context.gain)).toBe(true);
  });

  it("wakes the context in the same call as play and releases its source", async () => {
    vi.stubGlobal("AudioContext", FakeContext);
    const { createBoostedAudio } = await load();
    const element = createBoostedAudio();
    const [context] = contexts;

    await element.play();
    expect(context.resumes).toBe(1);
    expect((element as unknown as FakeAudio).plays).toBe(1);
    await element.play();
    expect(context.resumes).toBe(1);

    element.release?.();
    expect(context.sources[0].disconnected).toBe(true);
  });
});
