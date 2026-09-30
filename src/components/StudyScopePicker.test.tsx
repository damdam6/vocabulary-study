// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import StudyScopePicker from './StudyScopePicker.tsx';
import { fire, renderComponent } from '../test-utils.tsx';
let unmount: (() => void) | undefined;
afterEach(() => unmount?.());
it.each(['all', 'tabs'] as const)('shows settings in %s mode and select all only in tabs mode', (kind) => {
  const settings = vi.fn();
  const selected = vi.fn();
  const rendered = renderComponent(<StudyScopePicker kind={kind} tabs={[{ tab: '단어', count: 2 }, { tab: '문장', count: 1 }]} selected={[]} onKindChange={vi.fn()} onSelectedChange={selected} onNavigateTabModes={settings} />);
  unmount = rendered.unmount;
  const buttons = rendered.container.querySelectorAll<HTMLButtonElement>('.study-scope-toolbar button');
  expect([...buttons].map((button) => button.textContent)).toEqual(kind === 'tabs' ? ['탭별 유형 설정', '모두 선택'] : ['탭별 유형 설정']);
  fire(() => buttons[0].click());
  expect(settings).toHaveBeenCalledOnce();
  if (kind === 'tabs') {
    fire(() => buttons[1].click());
    expect(selected).toHaveBeenCalledWith(['단어', '문장']);
  }
  expect(rendered.container.querySelector('.study-scope-chips') !== null).toBe(kind === 'tabs');
});
