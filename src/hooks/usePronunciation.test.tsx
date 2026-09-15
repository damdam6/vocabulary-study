// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import { usePronunciation } from "./usePronunciation.ts";
import type { PronunciationBinding, PronunciationSnapshot } from "../lib/ttsTypes.ts";
import type { ContentType } from "../lib/api.ts";

const mocks = vi.hoisted(() => ({
  createController: vi.fn(),
  createAudio: vi.fn(() => ({})),
  createCache: vi.fn(() => ({})),
}));

vi.mock("../lib/speak.ts", () => ({ createPronunciationController: mocks.createController }));
vi.mock("../lib/ttsAudio.ts", () => ({ createTtsAudioOutput: mocks.createAudio }));
vi.mock("../lib/ttsBlobCache.ts", () => ({ createTtsBlobCache: mocks.createCache }));
vi.mock("../lib/ttsApi.ts", () => ({ fetchTtsAudio: vi.fn() }));

const enabledCapability = { enabled: true as const, revision: "r1", maxTextLength: 200 as const };
const idle = (): PronunciationSnapshot => ({
  status: "idle", questionId: null, enabled: true, inputReason: null, message: null,
});

function makeController() {
  let snapshot = idle();
  const listeners = new Set<(next: PronunciationSnapshot) => void>();
  const notify = () => listeners.forEach((listener) => listener(snapshot));
  return {
    activate: vi.fn((questionId: string) => {
      snapshot = { ...snapshot, questionId };
      notify();
    }),
    prepare: vi.fn(),
    reveal: vi.fn(),
    replay: vi.fn(),
    stop: vi.fn((reason: "advance" | "hidden" | "exit") => {
      if (reason !== "hidden") snapshot = { ...snapshot, questionId: null };
      notify();
    }),
    dispose: vi.fn(),
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener: (next: PronunciationSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
}

interface HarnessProps {
  contentType?: ContentType;
  questionId?: string;
  onBinding?: (binding: PronunciationBinding | undefined) => void;
}

function Harness({ contentType = "zh", questionId = "session:0", onBinding }: HarnessProps) {
  const { pronunciation } = usePronunciation({
    profileId: "profile",
    contentType,
    capability: enabledCapability,
    questionId,
    input: { text: "经济", pinyin: "jīngjì" },
  });
  onBinding?.(pronunciation);
  return <button type="button" onClick={() => pronunciation?.replay()}>재생</button>;
}

let unmountCurrent: (() => void) | null = null;

beforeEach(() => {
  mocks.createController.mockReset();
  mocks.createController.mockImplementation(makeController);
  mocks.createAudio.mockClear();
  mocks.createCache.mockClear();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  vi.restoreAllMocks();
});

describe("usePronunciation", () => {
  it("StrictMode cleanup 뒤 새 controller 하나만 연결하고 마지막 unmount에서 정리한다", async () => {
    const { unmount } = renderComponent(<StrictMode><Harness /></StrictMode>);
    unmountCurrent = unmount;
    await flush();

    expect(mocks.createController).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.createController.mock.results.map((result) => result.value);
    expect(first.stop).toHaveBeenCalledWith("exit");
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.activate).toHaveBeenCalledWith("session:0", { text: "经济", pinyin: "jīngjì" });

    unmount();
    unmountCurrent = null;
    expect(second.stop).toHaveBeenCalledWith("exit");
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it("generic에서는 controller·Audio·cache를 만들지 않는다", async () => {
    const { unmount } = renderComponent(<Harness contentType="generic" />);
    unmountCurrent = unmount;
    await flush();

    expect(mocks.createController).not.toHaveBeenCalled();
    expect(mocks.createAudio).not.toHaveBeenCalled();
    expect(mocks.createCache).not.toHaveBeenCalled();
  });

  it("hidden은 즉시 정지하고 visible 복귀는 자동 명령 없이 다음 수동 replay만 허용한다", async () => {
    const { container, unmount } = renderComponent(<Harness />);
    unmountCurrent = unmount;
    await flush();
    const controller = mocks.createController.mock.results[0].value;

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fire(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(controller.stop).toHaveBeenCalledWith("hidden");

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fire(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(controller.activate).toHaveBeenCalledTimes(1);
    fire(() => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(controller.replay).toHaveBeenCalledWith("session:0");
  });
});
