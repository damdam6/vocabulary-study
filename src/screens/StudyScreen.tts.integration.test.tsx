// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.tsx";
import StudyScreen from "./StudyScreen.tsx";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import { apiFetch, type PublicProfile, type WordEntry } from "../lib/api.ts";
import type { SessionQuestion } from "../lib/sessionQueue.ts";
import { RETRY_QUEUE_STORAGE_KEY } from "../lib/retryQueue.ts";

const profile: PublicProfile = { id: "zh", name: "중국어", modes: ["m1", "m2"], contentType: "zh" };
const enabled = { enabled: true as const, revision: "tts-v1", maxTextLength: 200 as const };
const disabled = { enabled: false as const };
const word: WordEntry = {
  tab: "HSK4", hanzi: "经济", pinyin: "jīngjì", meaning: "경제",
  m1: 1, m2: 1, nextReview: null, interval: null,
};
const sentenceWord: WordEntry = {
  ...word,
  hanzi: "今天下午三点，我们  一起去图书馆学习。价格是3.5元，增长了５％！",
  pinyin: "jīntiān xiàwǔ sān diǎn, wǒmen yìqǐ qù túshūguǎn xuéxí.",
  meaning: "오늘 오후 세 시에 우리는 함께 도서관에 가서 공부한다.",
};

class NativeAudioDouble {
  currentTime = 0;
  ended = false;
  error: unknown = null;
  readonly attributes = new Map<string, string>();
  readonly calls: string[] = [];
  readonly listeners = new Map<string, Set<() => void>>([["ended", new Set()], ["error", new Set()]]);

  play() {
    this.calls.push("play");
    return nextAudioPlayError === null ? Promise.resolve() : Promise.reject(nextAudioPlayError);
  }
  pause() { this.calls.push("pause"); }
  load() { this.calls.push("load"); }
  removeAttribute(name: string) { this.calls.push(`remove:${name}`); this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.calls.push(`set:${name}`); this.attributes.set(name, value); }
  addEventListener(type: string, listener: () => void) { this.listeners.get(type)?.add(listener); }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }
}

let audio: NativeAudioDouble;
let fetchMock: ReturnType<typeof vi.fn>;
let revoked: string[];
let unmountCurrent: (() => void) | null = null;
let nextTtsStatus = 200;
let nextWordsStatus = 200;
let answerStatus = 200;
let pendingTts: Promise<Response> | null = null;
let nextAudioPlayError: Error | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function ttsResponse(status = 200) {
  if (status !== 200) return new Response(JSON.stringify({ error: "tts_unavailable", message: "발음을 불러올 수 없습니다." }), {
    status, headers: { "Content-Type": "application/json" },
  });
  return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: {
    "Content-Type": "audio/mpeg", "X-TTS-Source": "GENERATED", "X-TTS-Storage": "UNCONFIRMED",
    "X-TTS-Pronunciation": "ignored", "X-TTS-Revision": "tts-v1",
  } });
}

function question(mode: "m1" | "m2"): SessionQuestion<WordEntry> {
  return { word, mode, isReview: false };
}

function ttsRequestCount() {
  return fetchMock.mock.calls.filter(([path]) => path === "/api/tts").length;
}

function wordsResponse(tts = enabled) {
  return Response.json({
    profile,
    words: [{ ...word, m1: 0, m2: 3, nextReview: null, interval: null }],
    settings: { sessionLimit: 1 },
    tts,
  });
}

async function startApp() {
  const rendered = renderComponent(<App />);
  unmountCurrent = rendered.unmount;
  await vi.waitFor(() => expect(rendered.container.querySelector<HTMLButtonElement>(".start-button")?.disabled).toBe(false));
  fire(() => rendered.container.querySelector<HTMLButtonElement>(".start-button")!.click());
  await flush();
  return rendered;
}

function transitionEnd(target: Element) {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "transform" });
  target.dispatchEvent(event);
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function finishFeedback(element: HTMLElement) {
  const props = Object.entries(element).find(([key]) => key.startsWith("__reactProps$"))?.[1] as { onAnimationEnd?: () => void } | undefined;
  if (!props?.onAnimationEnd) throw new Error("feedback animation handler missing");
  fire(() => props.onAnimationEnd?.());
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("app-password", "test-password");
  audio = new NativeAudioDouble();
  revoked = [];
  fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/words") return nextWordsStatus === 200 ? wordsResponse() : new Response(null, { status: nextWordsStatus });
    if (path === "/api/tts") return pendingTts ?? ttsResponse(nextTtsStatus);
    if (path === "/api/answer" || path === "/api/review-fail") return new Response(JSON.stringify(word), { status: answerStatus });
    throw new Error(`unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Audio", class { constructor() { return audio; } });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:integration"), revokeObjectURL: vi.fn((url: string) => revoked.push(url)) });
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    transitionProperty: "transform", transitionDuration: "550ms", transitionDelay: "0s",
  } as CSSStyleDeclaration);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  nextTtsStatus = 200;
  nextWordsStatus = 200;
  answerStatus = 200;
  pendingTts = null;
  nextAudioPlayError = null;
});

afterEach(() => {
  vi.useRealTimers();
  unmountCurrent?.();
  unmountCurrent = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("StudyScreen 중국어 음성 실제 연결 (#150)", () => {
  it("SENT-05: 모드1은 채점 정규화 전 문장 원문을 자동 한 번 전송하고 수동 replay는 cache를 재사용한다", async () => {
    const rendered = renderComponent(
      <StudyScreen queue={[{ word: sentenceWord, mode: "m1", isReview: false }]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />,
    );
    unmountCurrent = rendered.unmount;
    fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!));
    await vi.waitFor(() => expect(audio.calls.filter((call) => call === "play")).toHaveLength(1));

    const ttsCall = fetchMock.mock.calls.find(([path]) => path === "/api/tts")!;
    expect(JSON.parse(String((ttsCall[1] as RequestInit).body))).toEqual({
      text: sentenceWord.hanzi,
      pinyin: sentenceWord.pinyin,
    });
    expect(String((ttsCall[1] as RequestInit).body)).not.toContain("价格是35元");

    fire(() => rendered.container.querySelector<HTMLButtonElement>('[aria-label="발음 듣기"]')!.click());
    await vi.waitFor(() => expect(audio.calls.filter((call) => call === "play")).toHaveLength(2));
    expect(ttsRequestCount()).toBe(1);

    fire(() => rendered.container.querySelector<HTMLButtonElement>(".judge--o")!.click());
    await flush();
    const answerCall = fetchMock.mock.calls.find(([path]) => path === "/api/answer")!;
    expect(JSON.parse(String((answerCall[1] as RequestInit).body)).hanzi).toBe(sentenceWord.hanzi);
  });

  it("SENT-05: 모드2 오답 공개도 문장 원문을 자동 한 번 재생하고 수동 반복은 합성을 늘리지 않는다", async () => {
    const rendered = renderComponent(
      <StudyScreen queue={[{ word: sentenceWord, mode: "m2", isReview: false }]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />,
    );
    unmountCurrent = rendered.unmount;
    fire(() => setInput(rendered.container.querySelector<HTMLTextAreaElement>(".mode-input")!, "가격이 다른 오답"));
    fire(() => rendered.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await vi.waitFor(() => expect(audio.calls.filter((call) => call === "play")).toHaveLength(1));
    expect(JSON.parse(String((fetchMock.mock.calls.find(([path]) => path === "/api/tts")![1] as RequestInit).body)).text).toBe(sentenceWord.hanzi);
    fire(() => rendered.container.querySelector<HTMLButtonElement>('[aria-label="발음 듣기"]')!.click());
    await vi.waitFor(() => expect(audio.calls.filter((call) => call === "play")).toHaveLength(2));
    expect(ttsRequestCount()).toBe(1);
  });

  it("SENT-05: 200 code point는 요청하고 201자는 안내만 하며 원문 학습·기록을 계속한다", async () => {
    const boundary200 = `𠀀${"中".repeat(199)}`;
    const boundary201 = `${boundary200}中`;
    expect(boundary200.length).toBe(201);
    expect(Array.from(boundary200)).toHaveLength(200);

    const accepted = renderComponent(
      <StudyScreen queue={[{ word: { ...sentenceWord, hanzi: boundary200 }, mode: "m1", isReview: false }]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />,
    );
    fire(() => accepted.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(accepted.container.querySelector(".flip-card")!));
    await vi.waitFor(() => expect(ttsRequestCount()).toBe(1));
    accepted.unmount();

    const start = fetchMock.mock.calls.length;
    const rejected = renderComponent(
      <StudyScreen queue={[{ word: { ...sentenceWord, hanzi: boundary201 }, mode: "m1", isReview: false }]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />,
    );
    unmountCurrent = rejected.unmount;
    expect(rejected.container.textContent).toContain(boundary201);
    fire(() => rejected.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(rejected.container.querySelector(".flip-card")!));
    expect(rejected.container.textContent).toContain("발음은 200자까지 지원해요.");
    expect(rejected.container.querySelector<HTMLButtonElement>('[aria-label="발음 듣기"]')?.disabled).toBe(true);
    fire(() => rejected.container.querySelector<HTMLButtonElement>(".judge--o")!.click());
    await flush();
    const calls = fetchMock.mock.calls.slice(start);
    expect(calls.filter(([path]) => path === "/api/tts")).toHaveLength(0);
    expect(calls.filter(([path]) => path === "/api/answer").map(([, init]) => JSON.parse(String((init as RequestInit).body)).hanzi)).toEqual([boundary201]);
  });

  it("C1: StrictMode 모드1은 공개 완료 뒤 실제 transport/controller/audio를 한 번만 연결하고 빠른 판정 뒤 늦은 완료를 막는다", async () => {
    const rendered = renderComponent(
      <StrictMode><StudyScreen queue={[question("m1"), question("m2")]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} /></StrictMode>,
    );
    unmountCurrent = rendered.unmount;
    await flush();
    const front = rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!;
    fire(() => front.click());
    expect(ttsRequestCount()).toBe(1);
    const firstCard = rendered.container.querySelector(".flip-card")!;
    fire(() => transitionEnd(firstCard));
    await flush();
    expect(rendered.container.querySelector('[aria-label="발음 듣기"]')).not.toBeNull();
    expect(audio.calls.filter((call) => call === "play")).toHaveLength(1);

    // 다음 질문으로 이동한 뒤 이전 카드의 늦은 transition은 어떤 재생도 만들지 않는다.
    fire(() => rendered.container.querySelector<HTMLButtonElement>(".judge--o")!.click());
    fire(() => transitionEnd(firstCard));
    await flush();
    expect(audio.calls.filter((call) => call === "play")).toHaveLength(1);
  });

  it("C1: 준비 중 판정 또는 실제 unmount 뒤 늦은 TTS 응답은 재생하지 않는다", async () => {
    const grading = deferred<Response>();
    pendingTts = grading.promise;
    const first = renderComponent(<StudyScreen queue={[question("m1"), question("m2")]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />);
    const firstCard = first.container.querySelector(".flip-card")!;
    fire(() => first.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(firstCard));
    fire(() => first.container.querySelector<HTMLButtonElement>(".judge--o")!.click());
    grading.resolve(ttsResponse());
    await flush();
    expect(audio.calls.filter((call) => call === "play")).toHaveLength(0);
    first.unmount();

    const leaving = deferred<Response>();
    pendingTts = leaving.promise;
    const second = renderComponent(<StudyScreen queue={[question("m1")]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />);
    fire(() => second.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(second.container.querySelector(".flip-card")!));
    second.unmount();
    leaving.resolve(ttsResponse());
    await flush();
    expect(audio.calls.filter((call) => call === "play")).toHaveLength(0);
  });

  it("C2/C5: 모드2 일반·빈 오답만 정답 표제어를 요청하며 정답·off는 기존 학습 진행을 막지 않는다", async () => {
    const wrong = renderComponent(<StudyScreen queue={[question("m2"), question("m1")]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />);
    unmountCurrent = wrong.unmount;
    const input = wrong.container.querySelector<HTMLTextAreaElement>(".mode-input")!;
    fire(() => setInput(input, "   "));
    fire(() => wrong.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await vi.waitFor(() => expect(ttsRequestCount()).toBe(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ text: "经济", pinyin: "jīngjì" });
    expect(wrong.container.textContent).toContain("오답");
    await flush();
    wrong.unmount();
    unmountCurrent = null;

    const ordinaryWrong = renderComponent(<StudyScreen queue={[question("m2")]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />);
    unmountCurrent = ordinaryWrong.unmount;
    fire(() => setInput(ordinaryWrong.container.querySelector<HTMLTextAreaElement>(".mode-input")!, "틀린 답"));
    fire(() => ordinaryWrong.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await vi.waitFor(() => expect(ttsRequestCount()).toBe(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({ text: "经济", pinyin: "jīngjì" });
    await flush();
    ordinaryWrong.unmount();
    unmountCurrent = null;

    const correct = renderComponent(<StudyScreen queue={[question("m2")]} profile={profile} tts={disabled} onExit={vi.fn()} onComplete={vi.fn()} />);
    unmountCurrent = correct.unmount;
    fire(() => setInput(correct.container.querySelector<HTMLTextAreaElement>(".mode-input")!, "经济"));
    fire(() => correct.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(ttsRequestCount()).toBe(2);
    expect(correct.container.querySelector(".study-feedback-glyph")).not.toBeNull();
  });

  it("C5: B열 병음이 비어도 모드1 공개 뒤 A열만으로 실제 Audio를 재생한다", async () => {
    const rendered = renderComponent(<StudyScreen queue={[{ word: { ...word, pinyin: "" }, mode: "m1", isReview: false }]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />);
    unmountCurrent = rendered.unmount;
    fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!));
    await vi.waitFor(() => expect(ttsRequestCount()).toBe(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ text: "经济" });
    await vi.waitFor(() => expect(audio.calls).toContain("play"));
  });

  it.each(["m1-front", "m1-flipping", "m1-hidden-complete", "m2-input"] as const)(
    "R1: %s에서 숨김·복귀 뒤 자동 재개 없이 수동 재생한다 (StrictMode)",
    async (scenario) => {
      vi.useFakeTimers();
      const mode = scenario === "m2-input" ? "m2" : "m1";
      const rendered = renderComponent(
        <StrictMode><StudyScreen queue={[question(mode)]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} /></StrictMode>,
      );
      unmountCurrent = rendered.unmount;
      const flipping = scenario === "m1-flipping" || scenario === "m1-hidden-complete";
      const oldResponse = deferred<Response>();
      if (flipping) {
        pendingTts = oldResponse.promise;
        fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
        expect(ttsRequestCount()).toBe(1);
      }
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      fire(() => document.dispatchEvent(new Event("visibilitychange")));
      if (flipping) {
        const request = fetchMock.mock.calls.find(([path]) => path === "/api/tts")![1] as RequestInit;
        expect(request.signal?.aborted).toBe(true);
        oldResponse.resolve(ttsResponse());
        pendingTts = null;
      }
      if (scenario === "m1-hidden-complete") {
        fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!));
      }
      await flush();
      expect(audio.calls.filter((call) => call === "play")).toHaveLength(0);
      expect(rendered.container.querySelector('[aria-label="발음 듣기"]')).toBeNull();
      const beforeVisible = ttsRequestCount();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      fire(() => document.dispatchEvent(new Event("visibilitychange")));
      await flush();
      expect(ttsRequestCount()).toBe(beforeVisible);
      expect(audio.calls.filter((call) => call === "play")).toHaveLength(0);
      if (mode === "m2") {
        fire(() => rendered.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
      } else {
        if (!flipping) fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
        if (scenario !== "m1-hidden-complete") {
          expect(rendered.container.querySelector('[aria-label="발음 듣기"]')).toBeNull();
          fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!));
        }
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(ttsRequestCount()).toBe(beforeVisible);
      expect(audio.calls.filter((call) => call === "play")).toHaveLength(0);
      fire(() => rendered.container.querySelector<HTMLButtonElement>('[aria-label="발음 듣기"]')!.click());
      await flush();
      expect(audio.calls.filter((call) => call === "play")).toHaveLength(1);
      expect(ttsRequestCount()).toBe(beforeVisible + 1);
      fire(() => rendered.container.querySelector<HTMLButtonElement>('[aria-label="발음 듣기"]')!.click());
      await flush();
      expect(audio.calls.filter((call) => call === "play")).toHaveLength(2);
      expect(ttsRequestCount()).toBe(beforeVisible + 1);
    },
  );

  it("C3: hidden은 실제 Audio URL을 정리하고 visible 복귀는 자동 요청·재생 없이 수동 replay만 허용한다", async () => {
    const rendered = renderComponent(<StudyScreen queue={[question("m1")]} profile={profile} tts={enabled} onExit={vi.fn()} onComplete={vi.fn()} />);
    unmountCurrent = rendered.unmount;
    fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!));
    await vi.waitFor(() => expect(audio.calls).toContain("play"));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fire(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(audio.calls).toContain("pause");
    expect(revoked).toEqual(["blob:integration"]);
    const beforeVisible = fetchMock.mock.calls.length;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fire(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(beforeVisible);
    fire(() => rendered.container.querySelector<HTMLButtonElement>('[aria-label="발음 듣기"]')!.click());
    await vi.waitFor(() => expect(audio.calls.filter((call) => call === "play")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(beforeVisible);
  });

  it("C4: 실제 App/Home/Study 경계에서 provider 503은 로그인 상태를 보존하고 앱 401은 활성 Audio와 URL을 정리한다", async () => {
    nextTtsStatus = 503;
    const rendered = await startApp();
    fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!));
    await vi.waitFor(() => expect(ttsRequestCount()).toBe(1));
    await flush();
    expect(localStorage.getItem("app-password")).toBe("test-password");
    expect(rendered.container.querySelector(".study")).not.toBeNull();
    rendered.unmount();
    unmountCurrent = null;

    // 실제 apiFetch 401 handler가 App의 Study unmount를 통해 사용 중 Audio/Object URL을 해제한다.
    localStorage.setItem("app-password", "test-password");
    nextTtsStatus = 200;
    const active = await startApp();
    fire(() => active.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(active.container.querySelector(".flip-card")!));
    await vi.waitFor(() => expect(audio.calls).toContain("play"));
    nextWordsStatus = 401;
    await apiFetch("/api/words");
    await vi.waitFor(() => expect(active.container.querySelector(".login")).not.toBeNull());
    expect(localStorage.getItem("app-password")).toBeNull();
    expect(active.container.querySelector(".study")).toBeNull();
    expect(audio.calls).toContain("pause");
    expect(revoked).toContain("blob:integration");
  });

  it("C7: 실제 App success callback은 TTS 200 뒤 기존 answer retry를 flush하고 TTS 자체는 queue에 넣지 않는다", async () => {
    localStorage.setItem("vocab-study:profile", JSON.stringify(profile));
    localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, JSON.stringify([{
      kind: "answer", profileId: profile.id,
      record: { tab: "HSK4", hanzi: "기존", mode: "m1", timestamp: "2026-01-01 00:00", isReview: false },
    }]));
    answerStatus = 500;
    const rendered = await startApp();
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path === "/api/answer")).toHaveLength(1));
    expect(JSON.parse(localStorage.getItem(RETRY_QUEUE_STORAGE_KEY)!)).toHaveLength(1);
    answerStatus = 200;
    fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
    fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!));
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path === "/api/answer")).toHaveLength(2));
    expect(localStorage.getItem(RETRY_QUEUE_STORAGE_KEY)).toBe("[]");
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/tts")).toHaveLength(1);
  });

  it("C6: TTS 성공·실패·off·자동재생 차단 모두 같은 모드1 채점 기록을 남긴다", async () => {
    const outcomes: Array<{ records: unknown[]; ttsCalls: number }> = [];
    for (const scenario of ["success", "failure", "off", "blocked"] as const) {
      nextTtsStatus = scenario === "failure" ? 503 : 200;
      nextAudioPlayError = scenario === "blocked" ? new DOMException("자동재생이 차단됨", "NotAllowedError") : null;
      const onComplete = vi.fn();
      const start = fetchMock.mock.calls.length;
      const rendered = renderComponent(
        <StudyScreen queue={[question("m1")]} profile={profile} tts={scenario === "off" ? disabled : enabled} onExit={vi.fn()} onComplete={onComplete} />,
      );
      const card = rendered.container.querySelector(".flip-card")!;
      fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
      fire(() => transitionEnd(card));
      await flush();
      fire(() => rendered.container.querySelector<HTMLButtonElement>(".judge--o")!.click());
      await flush();
      expect(rendered.container.querySelector(".study-feedback-glyph")).not.toBeNull();
      const calls = fetchMock.mock.calls.slice(start);
      outcomes.push({
        records: calls.filter(([path]) => path === "/api/answer").map(([, init]) => JSON.parse(String((init as RequestInit).body))),
        ttsCalls: calls.filter(([path]) => path === "/api/tts").length,
      });
      rendered.unmount();
    }
    expect(outcomes.map(({ records }) => ({ records }))).toEqual([
      { records: [{ tab: "HSK4", hanzi: "经济", mode: "m1", isReview: false, timestamp: expect.any(String) }] },
      { records: [{ tab: "HSK4", hanzi: "经济", mode: "m1", isReview: false, timestamp: expect.any(String) }] },
      { records: [{ tab: "HSK4", hanzi: "经济", mode: "m1", isReview: false, timestamp: expect.any(String) }] },
      { records: [{ tab: "HSK4", hanzi: "经济", mode: "m1", isReview: false, timestamp: expect.any(String) }] },
    ]);
    expect(outcomes.map(({ ttsCalls }) => ttsCalls)).toEqual([1, 1, 0, 1]);
  });

  it("C6: 혼합 4문제 transcript는 TTS success/failure/off에서도 진행·기록·통계를 보존한다", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
    const queue: SessionQuestion<WordEntry>[] = [
      { word: { ...word, hanzi: "一" }, mode: "m1", isReview: false },
      { word: { ...word, hanzi: "二" }, mode: "m1", isReview: false },
      { word: { ...word, hanzi: "三" }, mode: "m2", isReview: true },
      { word: { ...word, hanzi: "四" }, mode: "m2", isReview: false },
    ];
    const outcomes: unknown[] = [];
    for (const scenario of ["success", "failure", "off"] as const) {
      nextTtsStatus = scenario === "failure" ? 503 : 200;
      localStorage.setItem("vocab-study:profile", JSON.stringify(profile));
      const complete = vi.fn(); const start = fetchMock.mock.calls.length;
      const rendered = renderComponent(<StudyScreen queue={queue} profile={profile} tts={scenario === "off" ? disabled : enabled} onExit={vi.fn()} onComplete={complete} />);
      const answerM1 = (correct: boolean) => { fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click()); fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!)); fire(() => rendered.container.querySelector<HTMLButtonElement>(correct ? ".judge--o" : ".judge--x")!.click()); finishFeedback(rendered.container.querySelector<HTMLElement>(".study-feedback-glyph")!); };
      answerM1(true); expect(rendered.container.querySelector(".study-progress-now")?.textContent).toBe("2");
      answerM1(false); expect(rendered.container.querySelector(".study-progress-now")?.textContent).toBe("3");
      fire(() => rendered.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
      expect(rendered.container.textContent).toContain("오답"); expect(rendered.container.querySelector(".study-progress-now")?.textContent).toBe("3");
      fire(() => [...rendered.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "다음")!.click());
      const input = rendered.container.querySelector<HTMLTextAreaElement>(".mode-input")!; fire(() => setInput(input, "四")); fire(() => rendered.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()); finishFeedback(rendered.container.querySelector<HTMLElement>(".study-feedback-glyph")!);
      await flush();
      const calls = fetchMock.mock.calls.slice(start); outcomes.push({ complete: complete.mock.calls[0]?.[0], answers: calls.filter(([path]) => path === "/api/answer").map(([, init]) => JSON.parse(String((init as RequestInit).body)).hanzi), reviews: calls.filter(([path]) => path === "/api/review-fail").map(([, init]) => JSON.parse(String((init as RequestInit).body)).hanzi), tts: calls.filter(([path]) => path === "/api/tts").length }); rendered.unmount();
    }
    expect(outcomes).toEqual([
      { complete: { correct: 2, wrong: 2 }, answers: ["一", "四"], reviews: ["三"], tts: 2 },
      { complete: { correct: 2, wrong: 2 }, answers: ["一", "四"], reviews: ["三"], tts: 2 },
      { complete: { correct: 2, wrong: 2 }, answers: ["一", "四"], reviews: ["三"], tts: 0 },
    ]);
    vi.useRealTimers();
  });

  it("C6: 혼합 transcript의 기록 5xx는 TTS와 무관하게 실제 retryQueue에 answer/review를 보존한다", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
    const queue: SessionQuestion<WordEntry>[] = [
      { word: { ...word, hanzi: "一" }, mode: "m1", isReview: false },
      { word: { ...word, hanzi: "二" }, mode: "m1", isReview: false },
      { word: { ...word, hanzi: "三" }, mode: "m2", isReview: true },
      { word: { ...word, hanzi: "四" }, mode: "m2", isReview: false },
    ];
    const outcomes: Array<{ tts: number; queue: unknown[] }> = [];
    for (const scenario of ["success", "failure", "off"] as const) {
      localStorage.clear(); localStorage.setItem("app-password", "test-password");
      localStorage.setItem("vocab-study:profile", JSON.stringify(profile));
      nextTtsStatus = scenario === "failure" ? 503 : 200;
      answerStatus = 500;
      const start = fetchMock.mock.calls.length;
      const rendered = renderComponent(<StudyScreen queue={queue} profile={profile} tts={scenario === "off" ? disabled : enabled} onExit={vi.fn()} onComplete={vi.fn()} />);
      const answerM1 = (correct: boolean) => { fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click()); fire(() => transitionEnd(rendered.container.querySelector(".flip-card")!)); fire(() => rendered.container.querySelector<HTMLButtonElement>(correct ? ".judge--o" : ".judge--x")!.click()); finishFeedback(rendered.container.querySelector<HTMLElement>(".study-feedback-glyph")!); };
      answerM1(true); answerM1(false);
      fire(() => rendered.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
      fire(() => [...rendered.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "다음")!.click());
      fire(() => setInput(rendered.container.querySelector<HTMLTextAreaElement>(".mode-input")!, "四"));
      fire(() => rendered.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
      finishFeedback(rendered.container.querySelector<HTMLElement>(".study-feedback-glyph")!);
      await flush(); await flush();
      const calls = fetchMock.mock.calls.slice(start);
      outcomes.push({ tts: calls.filter(([path]) => path === "/api/tts").length, queue: JSON.parse(localStorage.getItem(RETRY_QUEUE_STORAGE_KEY) ?? "[]") });
      rendered.unmount();
    }
    const expectedQueue = [
      { kind: "review-fail", profileId: "zh", record: { tab: "HSK4", hanzi: "三" } },
      { kind: "answer", profileId: "zh", record: { tab: "HSK4", hanzi: "一", mode: "m1", isReview: false, timestamp: "2026-09-17 09:00" } },
      { kind: "answer", profileId: "zh", record: { tab: "HSK4", hanzi: "四", mode: "m2", isReview: false, timestamp: "2026-09-17 09:00" } },
    ];
    expect(outcomes).toEqual([
      { tts: 2, queue: expectedQueue },
      { tts: 2, queue: expectedQueue },
      { tts: 0, queue: expectedQueue },
    ]);
    expect(outcomes.flatMap((outcome) => outcome.queue).every((entry) => (entry as { kind: string }).kind !== "tts")).toBe(true);
  });
});
