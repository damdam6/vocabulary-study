// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyScreen from "./StudyScreen.tsx";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import type { PublicProfile, WordEntry } from "../lib/api.ts";
import type { SessionQuestion } from "../lib/sessionQueue.ts";

const mocks = vi.hoisted(() => ({ stop: vi.fn() }));

vi.mock("../hooks/usePronunciation.ts", () => ({
  usePronunciation: () => ({ pronunciation: undefined, stop: mocks.stop }),
}));

const profile: PublicProfile = { id: "zh", name: "중국어", modes: ["m1", "m2"], contentType: "zh" };
const tts = { enabled: true as const, revision: "r1", maxTextLength: 200 as const };
const word: WordEntry = {
  tab: "HSK4", hanzi: "经济", pinyin: "jīngjì", meaning: "경제",
  m1: 1, m2: 1, nextReview: null, interval: null,
};

function question(mode: "m1" | "m2"): SessionQuestion<WordEntry> {
  return { word, mode, isReview: false };
}

let unmountCurrent: (() => void) | null = null;

beforeEach(() => mocks.stop.mockReset());
afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("StudyScreen 발음 정지 경계 (#145)", () => {
  it("모드2 정답은 완료 피드백 대기 중에도 즉시 advance 정지한다", async () => {
    const onComplete = vi.fn();
    const { container, unmount } = renderComponent(
      <StudyScreen queue={[question("m2")]} profile={profile} tts={tts} onExit={vi.fn()} onComplete={onComplete} />,
    );
    unmountCurrent = unmount;
    const input = container.querySelector<HTMLInputElement>(".mode-input")!;
    fire(() => setInput(input, "经济"));
    fire(() => container.querySelector<HTMLButtonElement>("button[type=submit]")!.click());
    await flush();

    expect(mocks.stop).toHaveBeenCalledWith("advance");
    expect(onComplete).not.toHaveBeenCalled();
    expect(container.querySelector(".study-feedback-glyph")).not.toBeNull();
  });

  it("모드2 오답은 결과 화면에 머무는 동안 advance 정지를 호출하지 않고 다음에서만 호출한다", () => {
    const { container, unmount } = renderComponent(
      <StudyScreen queue={[question("m2"), question("m1")]} profile={profile} tts={tts} onExit={vi.fn()} onComplete={vi.fn()} />,
    );
    unmountCurrent = unmount;
    const input = container.querySelector<HTMLInputElement>(".mode-input")!;
    fire(() => setInput(input, "오답"));
    fire(() => container.querySelector<HTMLButtonElement>("button[type=submit]")!.click());

    expect(container.textContent).toContain("오답");
    expect(mocks.stop).not.toHaveBeenCalled();
    fire(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "다음")!.click());
    expect(mocks.stop).toHaveBeenCalledWith("advance");
  });

  it("종료는 callback 직전에 exit 정지를 호출한다", () => {
    const onExit = vi.fn();
    const { container, unmount } = renderComponent(
      <StudyScreen queue={[question("m1")]} profile={profile} tts={tts} onExit={onExit} onComplete={vi.fn()} />,
    );
    unmountCurrent = unmount;

    fire(() => container.querySelector<HTMLButtonElement>(".study-exit")!.click());
    expect(mocks.stop).toHaveBeenCalledWith("exit");
    expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(onExit.mock.invocationCallOrder[0]);
  });
});
