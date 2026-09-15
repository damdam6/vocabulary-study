// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import type { PronunciationSnapshot } from "../lib/ttsTypes.ts";
import { fire, renderComponent } from "../test-utils.tsx";
import PronunciationButton from "./PronunciationButton.tsx";

let unmountCurrent: (() => void) | null = null;

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
});

const snapshot = (overrides: Partial<PronunciationSnapshot> = {}): PronunciationSnapshot => ({
  status: "ready",
  questionId: "question-1",
  enabled: true,
  inputReason: null,
  message: null,
  ...overrides,
});

function setup(current = snapshot()) {
  const replay = vi.fn();
  const { container, unmount } = renderComponent(<PronunciationButton snapshot={current} replay={replay} />);
  unmountCurrent = unmount;
  return { container, replay, button: container.querySelector<HTMLButtonElement>("button")! };
}

describe("PronunciationButton", () => {
  it.each(["idle", "ready", "playing", "blocked", "error"] as const)("%s 상태를 표시한다", (status) => {
    const { button } = setup(snapshot({ status }));

    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("발음 듣기");
    expect(button.type).toBe("button");
  });

  it("loading은 스피커 대신 busy 상태를 표시하고 replay는 그대로 전달한다", () => {
    const { button, replay } = setup(snapshot({ status: "loading" }));

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(false);
    fire(() => button.click());
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("자동 차단·실패는 live 안내 없이 조용히 표시한다", () => {
    for (const status of ["blocked", "error"] as const) {
      const { container } = setup(snapshot({ status, message: null }));
      expect(container.querySelector("[aria-live]")).toBeNull();
      unmountCurrent?.();
      unmountCurrent = null;
    }
  });

  it("수동 메시지만 polite live 영역으로 알린다", () => {
    const { container } = setup(snapshot({ status: "error", message: "발음을 다시 눌러 주세요." }));

    const message = container.querySelector("[aria-live='polite']");
    expect(message?.textContent).toBe("발음을 다시 눌러 주세요.");
  });

  it.each([
    ["text_too_long", "발음은 200자까지 지원해요."],
    ["invalid_text", "읽을 표제어가 없어요."],
  ] as const)("%s 입력 사유를 연결된 비활성 설명으로 표시한다", (inputReason, expectedMessage) => {
    const { container, button, replay } = setup(snapshot({ enabled: false, inputReason }));

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe("pronunciation-button-description");
    expect(container.textContent).toContain(expectedMessage);
    fire(() => button.click());
    expect(replay).not.toHaveBeenCalled();
  });

  it("form 안에서 클릭해도 replay 외 submit은 발생하지 않는다", () => {
    const replay = vi.fn();
    const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const { container, unmount } = renderComponent(
      <form onSubmit={submit}>
        <PronunciationButton snapshot={snapshot()} replay={replay} />
      </form>,
    );
    unmountCurrent = unmount;
    const button = container.querySelector<HTMLButtonElement>("button")!;

    fire(() => button.click());

    expect(replay).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });
});
