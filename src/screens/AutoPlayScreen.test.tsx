// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutoPlayScreen, {
  AUTO_PLAY_ERROR_MS, AUTO_PLAY_GAP_MS, AUTO_PLAY_SILENT_MS,
} from "./AutoPlayScreen.tsx";
import { fire, renderComponent } from "../test-utils.tsx";
import type { PublicProfile, WordEntry } from "../lib/api.ts";
import type { PronunciationSnapshot } from "../lib/ttsTypes.ts";

interface HookOptions { questionId: string | null; autoPlay?: boolean }

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  reveal: vi.fn(),
  replay: vi.fn(),
  status: "idle" as string,
  setStatus: (_status: string) => {},
  inputReason: null as string | null,
  bound: true,
  options: [] as Array<{ questionId: string | null; autoPlay?: boolean }>,
}));

vi.mock("../hooks/usePronunciation.ts", () => ({
  usePronunciation: (options: HookOptions) => {
    mocks.options.push(options);
    const [status, setStatus] = useState(mocks.status);
    mocks.setStatus = setStatus;
    if (!mocks.bound || options.questionId === null) return { pronunciation: undefined, stop: mocks.stop };
    const snapshot = {
      status, questionId: options.questionId, enabled: true, inputReason: mocks.inputReason, message: null,
    } as PronunciationSnapshot;
    return {
      pronunciation: { snapshot, prepare: vi.fn(), reveal: mocks.reveal, replay: mocks.replay },
      stop: mocks.stop,
    };
  },
}));

const zh: PublicProfile = { id: "zh", name: "중국어", modes: ["m1", "m2"], contentType: "zh" };
const generic: PublicProfile = { id: "en", name: "영어", modes: ["m1", "m2"], contentType: "generic" };
const tts = { enabled: true as const, revision: "r1", maxTextLength: 200 as const };
const base = { tab: "HSK4", m1: 1, m2: 1, nextReview: null, interval: null };
const words: WordEntry[] = [
  { ...base, hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
  { ...base, hanzi: "学习", pinyin: "xuéxí", meaning: "공부하다" },
];

let view: ReturnType<typeof renderComponent> | null = null;
let onExit = vi.fn();
let fetchMock = vi.fn();

function mount(profile = zh, list = words, capability: typeof tts | { enabled: false } = tts) {
  view = renderComponent(<AutoPlayScreen words={list} profile={profile} tts={capability} onExit={onExit} />);
  return view.container;
}
const hanzi = (container: HTMLElement) => container.querySelector(".mode-card-hanzi")?.textContent;
const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.stop.mockReset(); mocks.reveal.mockReset(); mocks.replay.mockReset();
  mocks.status = "idle"; mocks.inputReason = null; mocks.bound = true; mocks.options = [];
  onExit = vi.fn();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AutoPlayScreen", () => {
  it("표제어·병음·뜻을 한 번에 보여 주고 발음을 한 번 요청한다", () => {
    const container = mount();
    expect(hanzi(container)).toBe("经济");
    expect(container.querySelector(".mode-card-pinyin")?.textContent).toBe("jīngjì");
    expect(container.querySelector(".mode-card-meaning")?.textContent).toBe("경제");
    expect(container.querySelector(".study-progress")?.textContent).toBe("1 / 2");
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    expect(mocks.options.every((options) => options.autoPlay === true)).toBe(true);
  });

  it("발음이 끝나면 쉬었다가 다음 단어로 넘어간다", () => {
    const container = mount();
    fire(() => mocks.setStatus("loading"));
    fire(() => mocks.setStatus("playing"));
    fire(() => vi.advanceTimersByTime(10_000));
    expect(hanzi(container)).toBe("经济");
    fire(() => mocks.setStatus("ready"));
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_GAP_MS - 1));
    expect(hanzi(container)).toBe("经济");
    fire(() => vi.advanceTimersByTime(1));
    expect(hanzi(container)).toBe("学习");
    expect(mocks.stop).toHaveBeenCalledWith("advance");
    expect(mocks.reveal).toHaveBeenCalledTimes(2);
  });

  it("재생한 적 없는 ready(준비만 됨)에서는 간격 타이머로 넘어가지 않는다", () => {
    const container = mount();
    fire(() => mocks.setStatus("ready"));
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_GAP_MS * 2));
    expect(hanzi(container)).toBe("经济");
  });

  it("발음 없는 프로필은 고정 시간마다 넘어가고 끝나면 완료 화면에서 홈으로 돌아간다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    expect(mocks.reveal).not.toHaveBeenCalled();
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS - 1));
    expect(hanzi(container)).toBe("经济");
    fire(() => vi.advanceTimersByTime(1));
    expect(hanzi(container)).toBe("学习");
    expect(container.querySelector(".study-progress")?.textContent).toBe("2 / 2");
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    expect(container.textContent).toContain("재생이 끝났어요");
    fire(() => button(container, "홈으로").click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("일시정지 중에는 넘어가지 않고 재생을 누르면 같은 단어부터 이어진다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS - 100));
    fire(() => button(container, "일시정지").click());
    expect(mocks.stop).toHaveBeenCalledWith("advance");
    expect(container.textContent).toContain("일시정지");
    fire(() => vi.advanceTimersByTime(60_000));
    expect(hanzi(container)).toBe("经济");
    fire(() => button(container, "재생").click());
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS - 1));
    expect(hanzi(container)).toBe("经济");
    fire(() => vi.advanceTimersByTime(1));
    expect(hanzi(container)).toBe("学习");
  });

  it("발음 오류는 잠시 보여 준 뒤 넘어간다", () => {
    const container = mount();
    fire(() => mocks.setStatus("error"));
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_ERROR_MS - 1));
    expect(hanzi(container)).toBe("经济");
    fire(() => vi.advanceTimersByTime(1));
    expect(hanzi(container)).toBe("学习");
  });

  it("자동 재생이 막히면 멈추고 안내하며, 재생을 누르면 다시 요청한다", () => {
    mocks.status = "blocked";
    const container = mount();
    expect(container.querySelector(".autoplay-notice")).not.toBeNull();
    expect(button(container, "재생")).toBeDefined();
    fire(() => vi.advanceTimersByTime(60_000));
    expect(hanzi(container)).toBe("经济");
    // 재생 버튼은 클릭 스택에서 수동 재생(replay)을 직접 호출한다.
    fire(() => button(container, "재생").click());
    expect(mocks.replay).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".autoplay-notice")).toBeNull();
    fire(() => mocks.setStatus("playing"));
    fire(() => mocks.setStatus("ready"));
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_GAP_MS));
    expect(hanzi(container)).toBe("学习");
  });

  it("화면이 가려지면 일시정지한다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    fire(() => document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    fire(() => vi.advanceTimersByTime(60_000));
    expect(hanzi(container)).toBe("经济");
    expect(button(container, "재생")).toBeDefined();
  });

  it("재생할 수 없는 표제어는 발음 요청 없이 고정 시간 뒤 넘어간다", () => {
    mocks.inputReason = "text_too_long";
    const container = mount();
    expect(mocks.reveal).not.toHaveBeenCalled();
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    expect(hanzi(container)).toBe("学习");
  });

  it("종료는 재생을 멈추고 홈으로 돌아가며 학습 기록 요청을 보내지 않는다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    fire(() => button(container, "홈으로").click());
    expect(mocks.stop).toHaveBeenCalledWith("exit");
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("완료 화면에서 처음부터 다시 재생할 수 있다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    fire(() => button(container, "처음부터 다시").click());
    expect(hanzi(container)).toBe("经济");
    expect(container.querySelector(".study-progress")?.textContent).toBe("1 / 2");
  });
});
