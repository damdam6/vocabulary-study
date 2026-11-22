// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutoPlayScreen, {
  AUTO_PLAY_ERROR_MS, AUTO_PLAY_MEANING_LEAD_MS, AUTO_PLAY_SILENT_MS,
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
// 기본 대기 시간(2초) — 옵션에서 바꾸지 않았을 때 발음 종료 뒤 넘어가기까지의 시간.
const AUTO_PLAY_GAP_MS = 2000;
const hanzi = (container: HTMLElement) => container.querySelector(".mode-card-hanzi")?.textContent;
const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.stop.mockReset(); mocks.reveal.mockReset(); mocks.replay.mockReset();
  mocks.status = "idle"; mocks.inputReason = null; mocks.bound = true; mocks.options = [];
  onExit = vi.fn();
  localStorage.clear();
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
    fire(() => mocks.setStatus("idle"));
    const before = mocks.reveal.mock.calls.length;
    fire(() => button(container, "재생").click());
    expect(container.querySelector(".autoplay-notice")).toBeNull();
    expect(mocks.reveal.mock.calls.length).toBe(before + 1);
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

  // 옵션 모달을 열어 조작하고 닫는다 — 여는 동안은 재생이 멈추고, 닫으면 현재 단어부터 이어진다.
  function withOptions(container: HTMLElement, action: (modal: HTMLElement) => void) {
    fire(() => button(container, "옵션").click());
    const modal = container.querySelector<HTMLElement>(".autoplay-options-modal")!;
    action(modal);
    fire(() => button(container, "닫기").click());
    expect(container.querySelector(".autoplay-options-modal")).toBeNull();
  }
  const repeatToggle = (container: HTMLElement) => container.querySelector<HTMLButtonElement>(".autoplay-repeat-toggle")!;
  const setRepeat = (container: HTMLElement, on: boolean) => {
    if ((repeatToggle(container).getAttribute("aria-pressed") === "true") !== on) fire(() => repeatToggle(container).click());
    expect(repeatToggle(container).getAttribute("aria-pressed")).toBe(String(on));
  };
  const stepGap = (container: HTMLElement, label: "대기 시간 늘리기" | "대기 시간 줄이기", times: number) =>
    withOptions(container, (modal) => {
      for (let i = 0; i < times; i += 1) fire(() => modal.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
    });

  it("반복을 켜면 마지막 단어 뒤 처음으로 돌아가 계속 재생하고, 끄면 완료 화면으로 끝난다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    // 토글은 아이콘만 보이고 이름은 aria-label로 전달한다.
    expect(repeatToggle(container).textContent).toBe("");
    expect(repeatToggle(container).getAttribute("aria-label")).toBe("반복 재생");
    setRepeat(container, true);
    expect(repeatToggle(container).classList.contains("autoplay-repeat-toggle--on")).toBe(true);
    for (const expected of ["学习", "经济", "学习", "经济"]) {
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
      expect(hanzi(container)).toBe(expected);
    }
    expect(container.querySelector(".study-progress")?.textContent).toBe("1 / 2");
    setRepeat(container, false);
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    expect(container.textContent).toContain("재생이 끝났어요");
  });

  it("단어가 하나뿐이어도 반복하며 발음을 다시 요청한다", () => {
    const container = mount(zh, [words[0]]);
    setRepeat(container, true);
    const before = mocks.reveal.mock.calls.length;
    fire(() => mocks.setStatus("playing"));
    fire(() => mocks.setStatus("ready"));
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_GAP_MS));
    expect(hanzi(container)).toBe("经济");
    expect(container.textContent).not.toContain("재생이 끝났어요");
    expect(mocks.reveal.mock.calls.length).toBe(before + 1);
  });

  it("발음이 끝난 뒤 기본 2초를 기다리고, 옵션에서 늘린 대기 시간을 따른다", () => {
    const container = mount();
    fire(() => mocks.setStatus("playing"));
    fire(() => mocks.setStatus("ready"));
    fire(() => vi.advanceTimersByTime(1999));
    expect(hanzi(container)).toBe("经济");
    fire(() => vi.advanceTimersByTime(1));
    expect(hanzi(container)).toBe("学习");

    stepGap(container, "대기 시간 늘리기", 3);
    fire(() => mocks.setStatus("playing"));
    fire(() => mocks.setStatus("ready"));
    fire(() => vi.advanceTimersByTime(4999));
    expect(hanzi(container)).toBe("学习");
    fire(() => vi.advanceTimersByTime(1));
    expect(container.textContent).toContain("재생이 끝났어요");
  });

  it("대기 시간은 2초 아래로 내려가지 않고 값이 화면에 표시된다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    withOptions(container, (modal) => {
      const down = modal.querySelector<HTMLButtonElement>('[aria-label="대기 시간 줄이기"]')!;
      expect(modal.querySelector(".autoplay-stepper-value")?.textContent).toBe("2초");
      expect(down.disabled).toBe(true);
      fire(() => modal.querySelector<HTMLButtonElement>('[aria-label="대기 시간 늘리기"]')!.click());
      expect(modal.querySelector(".autoplay-stepper-value")?.textContent).toBe("3초");
      expect(down.disabled).toBe(false);
      fire(() => down.click());
      expect(modal.querySelector(".autoplay-stepper-value")?.textContent).toBe("2초");
    });
  });

  it("발음 없는 단어도 늘린 대기 시간이 3초보다 길면 그만큼 보여 준다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    stepGap(container, "대기 시간 늘리기", 4);
    fire(() => vi.advanceTimersByTime(5999));
    expect(hanzi(container)).toBe("经济");
    fire(() => vi.advanceTimersByTime(1));
    expect(hanzi(container)).toBe("学习");
  });

  it("옵션을 여는 동안 재생이 멈추고, 일시정지 상태에서 열었다 닫으면 그대로 멈춰 있다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    fire(() => button(container, "옵션").click());
    expect(mocks.stop).toHaveBeenCalledWith("advance");
    fire(() => vi.advanceTimersByTime(60_000));
    expect(hanzi(container)).toBe("经济");
    fire(() => button(container, "닫기").click());
    fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
    expect(hanzi(container)).toBe("学习");

    fire(() => button(container, "일시정지").click());
    withOptions(container, () => {});
    fire(() => vi.advanceTimersByTime(60_000));
    expect(hanzi(container)).toBe("学习");
    expect(button(container, "재생")).toBeDefined();
  });

  it("반복·대기 시간 설정은 프로필별로 저장되어 다음 진입에 유지된다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    setRepeat(container, true);
    stepGap(container, "대기 시간 늘리기", 2);
    view!.unmount();
    const again = mount(generic, words, { enabled: false });
    expect(repeatToggle(again).getAttribute("aria-pressed")).toBe("true");
    withOptions(again, (modal) => expect(modal.querySelector(".autoplay-stepper-value")?.textContent).toBe("4초"));
    view!.unmount();
    const other = mount(zh);
    expect(repeatToggle(other).getAttribute("aria-pressed")).toBe("false");
    withOptions(other, (modal) => expect(modal.querySelector(".autoplay-stepper-value")?.textContent).toBe("2초"));
  });

  describe("뜻(한국어) 읽어주기", () => {
    interface FakeUtterance { text: string; lang: string; volume: number; onstart: (() => void) | null; onend: (() => void) | null; onerror: (() => void) | null }
    let spoken: FakeUtterance[] = [];
    let cancel = vi.fn();
    let voices: Array<{ lang: string; localService: boolean }> = [];
    // 소리 없는 깨우기 발화(primeMeaningSpeech)는 빼고 실제로 읽은 뜻만 본다.
    const read = () => spoken.filter((item) => item.volume !== 0);
    const meaningSwitch = (modal: HTMLElement) => modal.querySelector<HTMLButtonElement>('[role="switch"]')!;

    beforeEach(() => {
      spoken = []; cancel = vi.fn(); voices = [{ lang: "ko-KR", localService: true }];
      vi.stubGlobal("SpeechSynthesisUtterance", class {
        lang = ""; volume = 1; voice: unknown = null; onend = null; onerror = null;
        text: string;
        constructor(text: string) { this.text = text; }
      });
      vi.stubGlobal("speechSynthesis", {
        speaking: false, pending: false, cancel,
        getVoices: () => voices,
        speak: (utterance: FakeUtterance) => { spoken.push(utterance); },
      });
    });

    it("발음이 끝나면 뜻을 한국어로 읽고, 읽기가 끝난 뒤 대기 시간을 쉬고 넘어간다", () => {
      const container = mount();
      fire(() => mocks.setStatus("playing"));
      fire(() => vi.advanceTimersByTime(5000));
      expect(read()).toHaveLength(0);
      fire(() => mocks.setStatus("ready"));
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_MEANING_LEAD_MS));
      expect(read().map((item) => [item.text, item.lang])).toEqual([["경제", "ko-KR"]]);
      fire(() => read()[0].onstart!());
      // 읽는 동안에는 넘어가지 않는다.
      fire(() => vi.advanceTimersByTime(10_000));
      expect(hanzi(container)).toBe("经济");
      fire(() => read()[0].onend!());
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_GAP_MS - 1));
      expect(hanzi(container)).toBe("经济");
      fire(() => vi.advanceTimersByTime(1));
      expect(hanzi(container)).toBe("学习");
    });

    it("발음 없는 프로필도 뜻을 읽어 주고 대기 시간 뒤 넘어간다", () => {
      mocks.bound = false;
      const container = mount(generic, words, { enabled: false });
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_MEANING_LEAD_MS));
      expect(read().map((item) => item.text)).toEqual(["경제"]);
      fire(() => read()[0].onend!());
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_GAP_MS));
      expect(hanzi(container)).toBe("学习");
    });

    it("한국어 음성이 없는 기기에서는 읽지 않고 기존 간격대로 넘어간다", () => {
      voices = [{ lang: "en-US", localService: true }];
      const container = mount();
      fire(() => mocks.setStatus("playing"));
      fire(() => mocks.setStatus("ready"));
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_MEANING_LEAD_MS));
      fire(() => vi.advanceTimersByTime(1));
      expect(read()).toHaveLength(0);
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_GAP_MS));
      expect(hanzi(container)).toBe("学习");
    });

    it("읽는 중 일시정지하면 읽기를 끊고, 재생하면 같은 단어를 처음부터 다시 진행한다", () => {
      mocks.bound = false;
      const container = mount(generic, words, { enabled: false });
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_MEANING_LEAD_MS));
      expect(read()).toHaveLength(1);
      fire(() => button(container, "일시정지").click());
      expect(cancel).toHaveBeenCalled();
      // 끊긴 읽기의 늦은 종료 신호는 진행에 영향을 주지 않는다.
      fire(() => read()[0].onend!());
      fire(() => vi.advanceTimersByTime(60_000));
      expect(hanzi(container)).toBe("经济");
      fire(() => button(container, "재생").click());
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_MEANING_LEAD_MS));
      expect(read().map((item) => item.text)).toEqual(["경제", "경제"]);
    });

    it("옵션에서 끄면 읽지 않고, 설정은 프로필별로 저장된다", () => {
      mocks.bound = false;
      const container = mount(generic, words, { enabled: false });
      withOptions(container, (modal) => {
        expect(meaningSwitch(modal).getAttribute("aria-checked")).toBe("true");
        fire(() => meaningSwitch(modal).click());
        expect(meaningSwitch(modal).getAttribute("aria-checked")).toBe("false");
      });
      fire(() => vi.advanceTimersByTime(AUTO_PLAY_SILENT_MS));
      expect(hanzi(container)).toBe("学习");
      expect(read()).toHaveLength(0);
      view!.unmount();
      const again = mount(generic, words, { enabled: false });
      withOptions(again, (modal) => expect(meaningSwitch(modal).getAttribute("aria-checked")).toBe("false"));
      view!.unmount();
      const other = mount(zh);
      withOptions(other, (modal) => expect(meaningSwitch(modal).getAttribute("aria-checked")).toBe("true"));
    });
  });

  it("음성 읽기를 지원하지 않는 브라우저에서는 뜻 읽어주기 스위치가 잠긴다", () => {
    mocks.bound = false;
    const container = mount(generic, words, { enabled: false });
    withOptions(container, (modal) => {
      const toggle = modal.querySelector<HTMLButtonElement>('[role="switch"]')!;
      expect(toggle.disabled).toBe(true);
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });
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
