// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import Mode3Card from "./Mode3Card.tsx";
import { fire, renderComponent } from "../test-utils.tsx";
import type { StudyQuestion } from "../lib/studySession.ts";
import type { WordEntry } from "../lib/api.ts";

const TAB = "THES. 6급유의어";
const make = (hanzi: string, meaning: string): WordEntry => ({
  tab: TAB, hanzi, pinyin: "", meaning, m1: 0, m2: 0, m3: 0, synonymGroup: "예쁨", nextReview: null, interval: null,
});
const answer = make("美丽", "아름답다");
const choices = [make("漂亮", "예쁘다"), answer, make("好看", "보기 좋다")];

let unmountCurrent: (() => void) | null = null;
afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
});

function render(prompt: "meaning" | "hanzi", onJudged = vi.fn(), onProceed = vi.fn()) {
  const question: StudyQuestion = { word: answer, mode: "m3", isReview: false, choices, prompt };
  const view = renderComponent(
    <Mode3Card question={question} contentType="zh" onJudged={onJudged} onProceed={onProceed} />,
  );
  unmountCurrent = view.unmount;
  const buttons = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>(".mode3-choice"));
  return { ...view, buttons, onJudged, onProceed };
}

describe("Mode3Card 유의어 고르기", () => {
  it("뜻 → 원문: 뜻을 보여주고 보기로 원문을 낸다. 정답 클릭은 onJudged(true) 한 번", () => {
    const view = render("meaning");
    expect(view.container.querySelector(".mode-card-meaning")?.textContent).toBe("아름답다");
    expect(view.buttons().map((button) => button.textContent)).toEqual(["漂亮", "美丽", "好看"]);
    fire(() => view.buttons()[1].click());
    fire(() => view.buttons()[1].click());
    expect(view.onJudged).toHaveBeenCalledTimes(1);
    expect(view.onJudged).toHaveBeenCalledWith(true);
    expect(view.container.querySelector(".mode-result-title")).toBeNull();
  });

  it("원문 → 뜻: 오답이면 정답·내 선택을 표시하고 '다음'에서 진행한다", () => {
    const view = render("hanzi");
    expect(view.buttons().map((button) => button.textContent)).toEqual(["예쁘다", "아름답다", "보기 좋다"]);
    fire(() => view.buttons()[0].click());
    expect(view.onJudged).toHaveBeenCalledWith(false);
    expect(view.container.querySelector(".mode-result-title")?.textContent).toBe("오답");
    expect(view.buttons()[1].className).toContain("mode3-choice--answer");
    expect(view.buttons()[0].className).toContain("mode3-choice--picked");
    expect(view.buttons().every((button) => button.disabled)).toBe(true);
    const next = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "다음")!;
    fire(() => next.click());
    expect(view.onProceed).toHaveBeenCalledTimes(1);
  });
});
