// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import type { ReactElement } from "react";
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

function setup(current = snapshot(), render?: (replay: () => void) => ReactElement) {
  const replay = vi.fn();
  const element = render?.(replay) ?? <PronunciationButton snapshot={current} replay={replay} />;
  const { container, unmount } = renderComponent(element);
  unmountCurrent = unmount;
  return { container, replay, button: container.querySelector<HTMLButtonElement>("button")! };
}

describe("PronunciationButton", () => {
  it("공통 접근성 속성과 type을 표시한다", () => {
    const { button } = setup();

    expect(button.getAttribute("aria-label")).toBe("발음 듣기");
    expect(button.type).toBe("button");
  });

  it.each([
    ["idle", "pronunciation-button", false],
    ["ready", "pronunciation-button", false],
    ["playing", "pronunciation-button pronunciation-button--playing", false],
    ["blocked", "pronunciation-button", false],
    ["error", "pronunciation-button", false],
  ] as const)("%s 상태의 modifier와 busy 속성을 표시한다", (status, className, busy) => {
    const { button, container } = setup(snapshot({ status }));

    expect(container.firstElementChild?.className).toBe(className);
    expect(button.getAttribute("aria-busy")).toBe(busy ? "true" : null);
  });

  it("loading은 상태 설명을 연결하고 busy를 표시한다", () => {
    const { button, container } = setup(snapshot({ status: "loading" }));

    expect(button.getAttribute("aria-busy")).toBe("true");
    const descriptionId = button.getAttribute("aria-describedby");
    expect(descriptionId).not.toBeNull();
    expect(container.querySelector(`#${descriptionId}`)?.textContent).toBe("발음을 준비하고 있어요.");
  });

  it("playing은 상태 설명을 연결한다", () => {
    const { button, container } = setup(snapshot({ status: "playing" }));

    const descriptionId = button.getAttribute("aria-describedby");
    expect(descriptionId).not.toBeNull();
    expect(container.querySelector(`#${descriptionId}`)?.textContent).toBe("발음을 재생하고 있어요.");
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

  it("여러 인스턴스가 각자의 설명 ID를 참조한다", () => {
    const first = snapshot({ enabled: false, inputReason: "text_too_long" });
    const second = snapshot({ enabled: false, inputReason: "invalid_text" });
    const replay = vi.fn();
    const { container, unmount } = renderComponent(
      <>
        <PronunciationButton snapshot={first} replay={replay} />
        <PronunciationButton snapshot={second} replay={replay} />
      </>,
    );
    unmountCurrent = unmount;

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    const descriptions = [...container.querySelectorAll<HTMLElement>(".pronunciation-button__message")];
    const describedBy = buttons.map((button) => button.getAttribute("aria-describedby"));

    expect(buttons).toHaveLength(2);
    expect(descriptions).toHaveLength(2);
    expect(new Set(describedBy).size).toBe(2);
    for (const [index, id] of describedBy.entries()) {
      expect(id).not.toBeNull();
      expect(container.querySelector(`#${id}`)).toBe(descriptions[index]);
    }
  });

  it.each([
    ["text_too_long", "발음은 200자까지 지원해요."],
    ["invalid_text", "읽을 표제어가 없어요."],
  ] as const)("%s 입력 사유를 연결된 비활성 설명으로 표시한다", (inputReason, expectedMessage) => {
    const { container, button, replay } = setup(snapshot({ enabled: false, inputReason }));

    expect(button.disabled).toBe(true);
    const descriptionId = button.getAttribute("aria-describedby");
    expect(descriptionId).not.toBeNull();
    expect(container.querySelector(`#${descriptionId}`)).not.toBeNull();
    expect(container.textContent).toContain(expectedMessage);
    fire(() => button.click());
    expect(replay).not.toHaveBeenCalled();
  });

  it("compact는 modifier를 붙이고 진행 상태 문구는 숨긴 채 설명으로만 연결한다", () => {
    const { button, container } = setup(snapshot({ status: "playing" }), (replay) => (
      <PronunciationButton snapshot={snapshot({ status: "playing" })} replay={replay} size="compact" />
    ));

    expect(container.firstElementChild?.className).toBe(
      "pronunciation-button pronunciation-button--compact pronunciation-button--playing",
    );
    const description = container.querySelector(`#${button.getAttribute("aria-describedby")}`);
    expect(description?.textContent).toBe("발음을 재생하고 있어요.");
    expect(description?.classList.contains("pronunciation-button__message--hidden")).toBe(true);
    expect(button.querySelector(".pronunciation-button__icon")).not.toBeNull();
  });

  it("compact도 수동 오류 문구는 보이게 둔다", () => {
    const current = snapshot({ status: "error", message: "발음을 다시 눌러 주세요." });
    const { container } = setup(current, (replay) => (
      <PronunciationButton snapshot={current} replay={replay} size="compact" />
    ));

    const message = container.querySelector("[aria-live='polite']");
    expect(message?.textContent).toBe("발음을 다시 눌러 주세요.");
    expect(message?.classList.contains("pronunciation-button__message--hidden")).toBe(false);
  });

  it("form 안에서 클릭해도 replay 외 submit은 발생하지 않는다", () => {
    const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const { button, replay } = setup(snapshot(), (onReplay) => (
      <form onSubmit={submit}>
        <PronunciationButton snapshot={snapshot()} replay={onReplay} />
      </form>
    ));

    fire(() => button.click());

    expect(replay).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });
});
