import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEANING_SPEECH_TIMEOUT_MS, meaningSpeechSupported, meaningSpeechText, speakMeaning } from "./meaningSpeech.ts";

interface FakeUtterance { text: string; lang: string; voice: unknown; onend: (() => void) | null; onerror: (() => void) | null }

let spoken: FakeUtterance[] = [];
let cancel = vi.fn();
let voices: Array<{ lang: string; localService: boolean; name: string }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  spoken = []; cancel = vi.fn(); voices = [];
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    lang = ""; voice: unknown = null; onend = null; onerror = null;
    text: string;
    constructor(text: string) { this.text = text; }
  });
  vi.stubGlobal("speechSynthesis", {
    speaking: false, pending: false, cancel,
    getVoices: () => voices,
    speak: (utterance: FakeUtterance) => { spoken.push(utterance); },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("meaningSpeechText", () => {
  it("자리 표시는 빼고 뜻 구분 기호는 쉼표로 바꾼다", () => {
    expect(meaningSpeechText("~에 대해 / 관하여")).toBe("에 대해, 관하여");
    expect(meaningSpeechText("  경제;  경제의 ")).toBe("경제, 경제의");
    expect(meaningSpeechText("이륙하다, (옷을) 벗다")).toBe("이륙하다, (옷을) 벗다");
    expect(meaningSpeechText(" ~ / ")).toBe("");
  });
});

describe("speakMeaning", () => {
  it("한국어로 읽고 끝나면 한 번만 알린다", () => {
    voices = [
      { lang: "en-US", localService: true, name: "en" },
      { lang: "ko-KR", localService: false, name: "remote" },
      { lang: "ko_KR", localService: true, name: "local" },
    ];
    const done = vi.fn();
    speakMeaning("경제", done);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("경제");
    expect(spoken[0].lang).toBe("ko-KR");
    expect(spoken[0].voice).toBe(voices[2]);
    spoken[0].onend!();
    spoken[0].onerror!();
    vi.advanceTimersByTime(MEANING_SPEECH_TIMEOUT_MS);
    expect(done.mock.calls).toEqual([["ended"]]);
  });

  it("음성 목록이 아직 비어 있으면 언어만 지정해 읽는다", () => {
    speakMeaning("경제", vi.fn());
    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice).toBeNull();
  });

  it("한국어 음성이 없거나 읽을 내용이 없으면 읽지 않고 실패로 알린다", () => {
    voices = [{ lang: "en-US", localService: true, name: "en" }];
    const done = vi.fn();
    speakMeaning("경제", done);
    voices = [];
    speakMeaning(" ~ ", done);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(spoken).toHaveLength(0);
    expect(done.mock.calls).toEqual([["failed"], ["failed"]]);
  });

  it("합성 오류와 끝나지 않는 읽기는 실패로 끝낸다", () => {
    const done = vi.fn();
    speakMeaning("경제", done);
    spoken[0].onerror!();
    speakMeaning("공부하다", done);
    vi.advanceTimersByTime(MEANING_SPEECH_TIMEOUT_MS);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(done.mock.calls).toEqual([["failed"], ["failed"]]);
  });

  it("취소하면 읽기를 끊고 알리지 않는다", () => {
    const done = vi.fn();
    const stop = speakMeaning("경제", done);
    stop();
    spoken[0].onend!();
    vi.advanceTimersByTime(MEANING_SPEECH_TIMEOUT_MS);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
  });

  it("음성 합성이 없는 환경에서는 지원하지 않는다고 답하고 실패로 알린다", () => {
    vi.unstubAllGlobals();
    expect(meaningSpeechSupported()).toBe(false);
    const done = vi.fn();
    speakMeaning("경제", done);
    vi.advanceTimersByTime(0);
    expect(done.mock.calls).toEqual([["failed"]]);
  });
});
