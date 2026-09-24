// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Mode2Card from "./Mode2Card.tsx";
import { fire, renderComponent } from "../test-utils.tsx";
import type { StudyQuestion } from "../lib/studySession.ts";
import type { PronunciationBinding, PronunciationSnapshot } from "../lib/ttsTypes.ts";

const word = { tab: "HSK4", hanzi: "经济", pinyin: "jīngjì", meaning: "경제", m1: 1, m2: 1, nextReview: null, interval: null };
const question: StudyQuestion = { word, mode: "m2", isReview: false };
const idleSnapshot: PronunciationSnapshot = {
  status: "idle", questionId: "q1", enabled: true, inputReason: null, message: null,
};

function binding(snapshot: PronunciationSnapshot = idleSnapshot): PronunciationBinding {
  return { snapshot, prepare: vi.fn(), reveal: vi.fn(), replay: vi.fn() };
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>(".mode-input")!;
  input.focus();
  fire(() => setInput(input, value));
  fire(() => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
}

let unmountCurrent: (() => void) | null = null;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  vi.useRealTimers();
});

describe("Mode2Card 정답 음성", () => {
  it("입력 중과 정답 제출에는 음성 UI나 명령이 없다", () => {
    const pronunciation = binding();
    const onJudged = vi.fn();
    const { container, unmount } = renderComponent(
      <Mode2Card question={question} contentType="zh" onJudged={onJudged} onProceed={vi.fn()} pronunciation={pronunciation} />,
    );
    unmountCurrent = unmount;
    expect(container.querySelector('[aria-label="발음 듣기"]')).toBeNull();
    submit(container, "经济");
    fire(() => vi.runAllTimers());
    expect(onJudged).toHaveBeenCalledWith(true);
    expect(pronunciation.reveal).not.toHaveBeenCalled();
    expect(pronunciation.replay).not.toHaveBeenCalled();
  });

  it.each([["오답", "오답"], ["   ", ""]])("%s 오답은 DOM 커밋 뒤 공개를 한 번만 호출한다", (answer, renderedAnswer) => {
    const pronunciation = binding();
    const onJudged = vi.fn();
    const { container, unmount } = renderComponent(
      <Mode2Card question={question} contentType="zh" onJudged={onJudged} onProceed={vi.fn()} pronunciation={pronunciation} />,
    );
    unmountCurrent = unmount;
    submit(container, answer);
    expect(container.querySelector(".mode-card--result")).not.toBeNull();
    expect(pronunciation.reveal).not.toHaveBeenCalled();
    fire(() => vi.runAllTimers());
    expect(pronunciation.reveal).toHaveBeenCalledTimes(1);
    expect(onJudged).toHaveBeenCalledTimes(1);
    expect(onJudged).toHaveBeenCalledWith(false);
    expect(container.textContent).toContain("经济");
    if (renderedAnswer === "") expect(container.querySelector(".mode-my-answer")).toBeNull();
  });

  it("수동 버튼은 replay만 호출하고 정답 병음 오른쪽 같은 행에 있다", () => {
    const pronunciation = binding();
    const onJudged = vi.fn();
    const onProceed = vi.fn();
    const { container, unmount } = renderComponent(
      <Mode2Card question={question} contentType="zh" onJudged={onJudged} onProceed={onProceed} pronunciation={pronunciation} />,
    );
    unmountCurrent = unmount;
    submit(container, "오답");
    const row = container.querySelector(".pinyin-speaker")!;
    const button = row.querySelector<HTMLButtonElement>('[aria-label="발음 듣기"]')!;
    expect(row.querySelector(".mode-card-pinyin")?.textContent).toBe(word.pinyin);
    expect(row.textContent).not.toContain(word.hanzi);
    expect(row.querySelector(".pronunciation-button--compact")).not.toBeNull();
    expect(button.type).toBe("button");
    fire(() => button.click());
    expect(pronunciation.replay).toHaveBeenCalledTimes(1);
    expect(onJudged).toHaveBeenCalledTimes(1);
    expect(onProceed).not.toHaveBeenCalled();
  });

  it("binding이 없으면 버튼과 자동 명령 없이 다음 버튼으로 초점을 옮긴다", () => {
    const { container, unmount } = renderComponent(
      <Mode2Card question={question} contentType="generic" onJudged={vi.fn()} onProceed={vi.fn()} />,
    );
    unmountCurrent = unmount;
    submit(container, "오답");
    expect(container.querySelector('[aria-label="발음 듣기"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("다음");
  });

  it("활성 binding이면 발음 버튼으로 초점을 옮기고 비활성이면 다음으로 fallback한다", () => {
    const enabled = binding();
    const first = renderComponent(
      <Mode2Card question={question} contentType="zh" onJudged={vi.fn()} onProceed={vi.fn()} pronunciation={enabled} />,
    );
    submit(first.container, "오답");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("발음 듣기");
    first.unmount();

    const disabled = binding({ ...idleSnapshot, enabled: false });
    const second = renderComponent(
      <Mode2Card question={question} contentType="zh" onJudged={vi.fn()} onProceed={vi.fn()} pronunciation={disabled} />,
    );
    unmountCurrent = second.unmount;
    submit(second.container, "오답");
    expect(document.activeElement?.textContent).toBe("다음");
  });

  it("StrictMode에서도 자동 공개는 한 번만 실행된다", () => {
    const pronunciation = binding();
    const { container, unmount } = renderComponent(
      <StrictMode><Mode2Card question={question} contentType="zh" onJudged={vi.fn()} onProceed={vi.fn()} pronunciation={pronunciation} /></StrictMode>,
    );
    unmountCurrent = unmount;
    submit(container, "오답");
    fire(() => vi.runAllTimers());
    expect(pronunciation.reveal).toHaveBeenCalledTimes(1);
  });

  it("binding snapshot 재렌더에도 공개 기회를 중복 소비하지 않는다", () => {
    const reveal = vi.fn();
    function Harness() {
      const [status, setStatus] = useState<PronunciationSnapshot["status"]>("idle");
      const pronunciation: PronunciationBinding = {
        snapshot: { ...idleSnapshot, status },
        prepare: vi.fn(), reveal, replay: vi.fn(),
      };
      return <>
        <Mode2Card question={question} contentType="zh" onJudged={vi.fn()} onProceed={vi.fn()} pronunciation={pronunciation} />
        <button type="button" className="update-binding" onClick={() => setStatus((current) => current === "idle" ? "loading" : "playing")}>상태 변경</button>
      </>;
    }
    const { container, unmount } = renderComponent(<Harness />);
    unmountCurrent = unmount;
    submit(container, "오답");
    fire(() => container.querySelector<HTMLButtonElement>(".update-binding")!.click());
    fire(() => vi.runAllTimers());
    fire(() => container.querySelector<HTMLButtonElement>(".update-binding")!.click());
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("판정 중 사용자가 다른 제어로 옮긴 초점을 빼앗지 않는다", () => {
    const external = document.createElement("button");
    document.body.appendChild(external);
    const { container, unmount } = renderComponent(
      <Mode2Card
        question={question}
        contentType="zh"
        onJudged={() => external.focus()}
        onProceed={vi.fn()}
        pronunciation={binding()}
      />,
    );
    unmountCurrent = () => { unmount(); external.remove(); };
    submit(container, "오답");
    expect(document.activeElement).toBe(external);
  });

  it("예약 전에 떠나면 공개 timer를 정리한다", () => {
    const pronunciation = binding();
    const rendered = renderComponent(
      <Mode2Card question={question} contentType="zh" onJudged={vi.fn()} onProceed={vi.fn()} pronunciation={pronunciation} />,
    );
    submit(rendered.container, "오답");
    rendered.unmount();
    fire(() => vi.runAllTimers());
    expect(pronunciation.reveal).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("빈 병음과 200자 결과를 보존하고 다음 제어는 scroll 밖에 둔다", () => {
    const longHanzi = "汉".repeat(200);
    const longQuestion: StudyQuestion = {
      ...question,
      word: { ...word, hanzi: longHanzi, pinyin: "", meaning: "긴 뜻 ".repeat(50) },
    };
    const { container, unmount } = renderComponent(
      <Mode2Card question={longQuestion} contentType="zh" onJudged={vi.fn()} onProceed={vi.fn()} pronunciation={binding()} />,
    );
    unmountCurrent = unmount;
    submit(container, "사용자 오답 ".repeat(30));
    const scroll = container.querySelector(".mode2-result-scroll")!;
    expect(scroll.textContent).toContain(longHanzi);
    expect(scroll.querySelector(".mode-card-pinyin")).toBeNull();
    expect(scroll.querySelector(".pinyin-speaker--no-pinyin")).not.toBeNull();
    expect(scroll.textContent).toContain("사용자 오답");
    expect(scroll.querySelector('button[aria-label="발음 듣기"]')).not.toBeNull();
    expect(scroll.contains(container.querySelector(".primary-button"))).toBe(false);
  });

  it("zh 문장부호 차이는 정답이고 generic은 오답이며 오답 원문은 그대로 표시한다", () => {
    const zh = renderComponent(
      <Mode2Card
        question={{ ...question, word: { ...word, hanzi: "你好，世界！" } }}
        contentType="zh"
        onJudged={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    submit(zh.container, "你好, 世界!");
    expect(zh.container.querySelector(".mode-card--result")).toBeNull();
    zh.unmount();

    const generic = renderComponent(
      <Mode2Card
        question={{ ...question, word: { ...word, hanzi: "hello!" } }}
        contentType="generic"
        onJudged={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    unmountCurrent = generic.unmount;
    submit(generic.container, "  hello?  ");
    expect(generic.container.querySelector(".mode-my-answer s")?.textContent).toBe("  hello?  ");
  });
});
