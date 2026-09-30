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
  const onNavigateTabModes = vi.fn();
  const { container, unmount } = renderComponent(
    <HomeUtilBar onNavigateTabModes={onNavigateTabModes} onNavigateRegister={onNavigateRegister} onSwitchProfile={onSwitchProfile} />,
  );
  unmountCurrent = unmount;

  const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return {
    container,
    onNavigateTabModes,
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

  it("수정 메뉴에서 등록을 선택하면 이동한다", () => {
    const { container, editButton, onNavigateRegister, onSwitchProfile } = setup();

    fire(() => editButton.click());

    expect(onNavigateRegister).not.toHaveBeenCalled();
    fire(() => container.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
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

it("설정 이동, Esc와 바깥 클릭 닫기를 지원한다", () => {
  const { container, editButton, onNavigateTabModes } = setup();
  fire(() => editButton.click());
  const items = container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  expect([...items].map(item => item.textContent)).toEqual(['어휘/문장 등록', '탭별 문제 유형 설정']);
  expect(document.activeElement).toBe(items[0]);
  fire(() => items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(document.activeElement).toBe(items[1]);
  fire(() => items[1].click());
  expect(onNavigateTabModes).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="menu"]')).toBeNull();
  fire(() => editButton.click());
  fire(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(editButton);
  expect(editButton.getAttribute('aria-expanded')).toBe('false');
  fire(() => editButton.click());
  fire(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(container.querySelector('[role="menu"]')).toBeNull();
});
