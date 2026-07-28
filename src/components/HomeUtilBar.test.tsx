// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeUtilBar from "./HomeUtilBar.tsx";
import { fire, renderComponent } from "../test-utils.tsx";

let unmountCurrent: (() => void) | null = null;

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
});

function setup() {
  const onNavigateRegister = vi.fn();
  const onSwitchProfile = vi.fn();
  const { container, unmount } = renderComponent(
    <HomeUtilBar onNavigateRegister={onNavigateRegister} onSwitchProfile={onSwitchProfile} />,
  );
  unmountCurrent = unmount;

  const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return {
    container,
    onNavigateRegister,
    onSwitchProfile,
    editButton: byLabel("수정")!,
    personButton: byLabel("프로필 전환")!,
  };
}

describe("HomeUtilBar", () => {
  it("아이콘 버튼 2개를 aria-label과 함께 렌더하고, SVG는 접근성 트리에서 제외한다", () => {
    const { container, editButton, personButton } = setup();

    expect(editButton).not.toBeNull();
    expect(personButton).not.toBeNull();

    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("수정 버튼을 누르면 메뉴 없이 즉시 등록 화면 이동 콜백을 호출한다 (#112)", () => {
    const { editButton, onNavigateRegister, onSwitchProfile } = setup();

    fire(() => editButton.click());

    expect(onNavigateRegister).toHaveBeenCalledTimes(1);
    expect(onSwitchProfile).not.toHaveBeenCalled();
  });

  it("사람 버튼은 메뉴 없이 즉시 프로필 전환한다", () => {
    const { personButton, onNavigateRegister, onSwitchProfile } = setup();

    fire(() => personButton.click());

    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
    expect(onNavigateRegister).not.toHaveBeenCalled();
  });
});
