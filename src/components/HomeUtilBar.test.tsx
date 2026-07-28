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
    menu: () => container.querySelector<HTMLUListElement>('[role="menu"]'),
    menuItems: () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')),
  };
}

describe("HomeUtilBar", () => {
  it("아이콘 버튼 2개를 aria-label과 함께 렌더하고, SVG는 접근성 트리에서 제외한다", () => {
    const { container, editButton, personButton } = setup();

    expect(editButton).not.toBeNull();
    expect(personButton).not.toBeNull();
    expect(editButton.getAttribute("aria-haspopup")).toBe("menu");
    expect(editButton.getAttribute("aria-expanded")).toBe("false");

    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("수정 버튼을 누르면 메뉴가 열리고, 옵션은 '단어 등록' 하나뿐이다 (문제 수 수정은 후속 작업 소관)", () => {
    const { editButton, menu, menuItems } = setup();

    expect(menu()).toBeNull();

    fire(() => editButton.click());

    expect(menu()).not.toBeNull();
    expect(editButton.getAttribute("aria-expanded")).toBe("true");
    expect(menuItems().map((item) => item.textContent)).toEqual(["단어 등록"]);
  });

  it("메뉴가 열리면 첫 항목이 포커스를 받는다", () => {
    const { editButton, menuItems } = setup();

    fire(() => editButton.click());

    expect(document.activeElement).toBe(menuItems()[0]);
  });

  it("메뉴 바깥 pointerdown으로 닫히고, 메뉴 안쪽 pointerdown으로는 닫히지 않는다", () => {
    const { editButton, menu } = setup();

    fire(() => editButton.click());
    // jsdom에 PointerEvent 생성자가 없을 수 있어 MouseEvent로 디스패치한다 —
    // 리스너는 타입 문자열로 매칭되므로 구현 경로는 동일하다.
    fire(() => menu()!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(menu()).not.toBeNull();

    fire(() => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(menu()).toBeNull();
  });

  it("Escape로 닫히고 포커스가 수정 버튼으로 돌아온다", () => {
    const { editButton, menu } = setup();

    fire(() => editButton.click());
    fire(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(editButton);
  });

  it("'단어 등록'을 고르면 등록 화면으로 이동시키고 메뉴를 닫는다", () => {
    const { editButton, menu, menuItems, onNavigateRegister, onSwitchProfile } = setup();

    fire(() => editButton.click());
    fire(() => menuItems()[0].click());

    expect(onNavigateRegister).toHaveBeenCalledTimes(1);
    expect(onSwitchProfile).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("사람 버튼은 메뉴 없이 즉시 프로필 전환한다", () => {
    const { personButton, menu, onNavigateRegister, onSwitchProfile } = setup();

    fire(() => personButton.click());

    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
    expect(onNavigateRegister).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });
});
