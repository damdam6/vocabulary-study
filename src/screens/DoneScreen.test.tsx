// @vitest-environment jsdom
//
// 세션 결과 화면(design-prd §5): 요약 수치, 틀린 문제 → 맞힌 문제 순서, 내 답 표시,
// 조작은 [이미지 저장] [홈] 두 버튼뿐. canvas가 없는 jsdom이라 이미지 생성·저장은 모킹한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DoneScreen from "./DoneScreen.tsx";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import type { PublicProfile, WordEntry } from "../lib/api.ts";
import type { QuestionResult } from "../lib/studySession.ts";
import type { SessionResult } from "./StudyScreen.tsx";

const mocks = vi.hoisted(() => ({ render: vi.fn(), save: vi.fn() }));
vi.mock("../lib/resultImage.ts", () => ({ renderResultImage: mocks.render, saveResultImage: mocks.save }));

const zh: PublicProfile = { id: "zh", name: "HSK 6급", modes: ["m1", "m2"], contentType: "zh" };

function word(hanzi: string, pinyin: string, meaning: string): WordEntry {
  return { tab: "HSK6", hanzi, pinyin, meaning, m1: 0, m2: 0, nextReview: null, interval: null };
}

function sessionResult(results: QuestionResult[]): SessionResult {
  return { correct: results.filter((r) => r.correct).length, wrong: results.filter((r) => !r.correct).length, results };
}

const mixed = sessionResult([
  { word: word("经济", "jīngjì", "경제"), mode: "m1", isReview: false, correct: true },
  { word: word("犹豫", "yóuyù", "망설이다"), mode: "m2", isReview: true, correct: false, answer: " 尤豫 " },
  { word: word("尴尬", "gāngà", "난처하다"), mode: "m1", isReview: false, correct: false },
]);

let unmountCurrent: (() => void) | null = null;

function setup(result: SessionResult = mixed, profile: PublicProfile = zh) {
  const onGoHome = vi.fn();
  const { container, unmount } = renderComponent(<DoneScreen result={result} profile={profile} onGoHome={onGoHome} />);
  unmountCurrent = unmount;
  return { container, onGoHome };
}

beforeEach(() => {
  mocks.render.mockReset();
  mocks.render.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  mocks.save.mockReset();
});

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
});

describe("DoneScreen 세션 결과", () => {
  it("정답률과 정답·오답 수를 보여 준다", () => {
    const { container } = setup();
    expect(container.querySelector(".result-rate-value")?.textContent).toBe("33%");
    expect(container.querySelector(".result-stat-num--correct")?.textContent).toBe("1");
    expect(container.querySelector(".result-stat-num--wrong")?.textContent).toBe("2");
  });

  it("틀린 문제를 먼저, 맞힌 문제를 나중에 출제 번호와 함께 나열한다", () => {
    const { container } = setup();
    const sections = [...container.querySelectorAll(".result-section")];
    expect(sections.map((s) => s.querySelector(".result-section-title")?.textContent)).toEqual(["틀린 문제2", "맞힌 문제1"]);
    const rows = [...container.querySelectorAll(".result-row")].map((row) => [
      row.querySelector(".result-num")?.textContent,
      row.querySelector(".result-hanzi")?.textContent,
      row.querySelector(".result-mark")?.getAttribute("aria-label"),
    ]);
    expect(rows).toEqual([["2", "犹豫", "오답"], ["3", "尴尬", "오답"], ["1", "经济", "정답"]]);
  });

  it("모드2 오답은 내 답을 취소선으로 보여 주고, 모드1 오답은 정오 외 표시를 덧붙이지 않는다", () => {
    const { container } = setup();
    const [m2Wrong, m1Wrong] = container.querySelectorAll(".result-row--wrong");
    expect(m2Wrong.querySelector(".result-answer s")?.textContent).toBe("尤豫");
    expect(m2Wrong.textContent).toContain("복습");
    expect(m2Wrong.textContent).toContain("뜻 → 중국어");
    expect(m1Wrong.querySelector(".result-answer")).toBeNull();
    expect([...m1Wrong.querySelectorAll(".result-chip")].map((chip) => chip.textContent)).toEqual(["중국어 → 뜻"]);
    expect(m1Wrong.querySelector(".result-hanzi")?.getAttribute("lang")).toBe("zh-Hans");
  });

  it("누를 수 있는 것은 이미지 저장·홈 두 버튼뿐이다", () => {
    const { container, onGoHome } = setup();
    const buttons = [...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(buttons).toEqual(["이미지로 저장", "홈으로"]);
    fire(() => container.querySelector<HTMLButtonElement>(".result-home")!.click());
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it("진입 시 이미지를 미리 그리고, 저장 버튼은 그 이미지를 저장한다", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    mocks.render.mockResolvedValue(blob);
    const { container } = setup();
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.render.mock.calls[0][0]).toMatchObject({ contentType: "zh", profileName: "HSK 6급", summary: { total: 3, wrong: 2 } });

    fire(() => container.querySelector<HTMLButtonElement>(".result-save")!.click());
    await flush();
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(blob, expect.stringMatching(/^session-result-\d{8}-\d{4}\.png$/));
    expect(container.querySelector(".result-save-error")).toBeNull();
  });

  it("미리 그리기가 실패하면 저장 시 다시 그리고, 그래도 실패하면 오류를 알린다", async () => {
    mocks.render.mockRejectedValue(new Error("no canvas"));
    const { container } = setup();
    fire(() => container.querySelector<HTMLButtonElement>(".result-save")!.click());
    await flush();
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(container.querySelector(".result-save-error")?.textContent).toBe("이미지를 저장하지 못했습니다");
  });

  it("전부 맞히면 틀린 문제 구간 없이 축하 문구를 보여 주고, generic은 lang·빈 보조 표기를 생략한다", () => {
    const generic: PublicProfile = { id: "en", name: "영어", modes: ["m1", "m2"], contentType: "generic" };
    const { container } = setup(
      sessionResult([{ word: word("take off", "", "이륙하다"), mode: "m2", isReview: false, correct: true }]),
      generic,
    );
    expect(container.querySelector(".result-perfect")?.textContent).toBe("이번 세션은 모두 맞혔어요.");
    expect(container.querySelectorAll(".result-section")).toHaveLength(1);
    expect(container.querySelector(".result-hanzi")?.hasAttribute("lang")).toBe(false);
    expect(container.querySelector(".result-pinyin")).toBeNull();
    expect(container.textContent).toContain("뜻 → 단어");
  });
});
