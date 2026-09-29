// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TabModesScreen from './TabModesScreen.tsx';
import { fire, flush, renderComponent } from '../test-utils.tsx';

let unmount: (() => void) | undefined;
let saved: unknown;
let saveFails = false;
const tabs = [{ id: 10, name: '단어', modes: ['m1', 'm2'], explicit: false }, { id: 20, name: '문장', modes: ['m1'], explicit: true }];
beforeEach(() => {
  localStorage.clear(); saved = undefined; saveFails = false;
  vi.stubGlobal('fetch', vi.fn(async (_path, init) => {
    if (init?.method === 'POST') {
      saved = JSON.parse(init.body);
      if (saveFails) return Response.json({ error: '저장 실패' }, { status: 500 });
      return Response.json({ tabs: (saved as { tabs: { id: number; modes: string[] }[] }).tabs.map((tab) => ({ ...tab, name: tabs.find((entry) => entry.id === tab.id)!.name, explicit: true })) });
    }
    return Response.json({ tabs });
  }));
});
afterEach(() => { unmount?.(); vi.unstubAllGlobals(); });
function setup() {
  const rendered = renderComponent(<TabModesScreen onGoHome={vi.fn()} />);
  unmount = rendered.unmount;
  return rendered.container;
}

describe('tab mode settings UI', () => {
  it('loads all tabs and blocks empty choices, then saves m2-only selections', async () => {
    const container = setup();
    expect(container.textContent).toContain('불러오는 중');
    await flush();
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect([...checkboxes].map((input) => input.checked)).toEqual([true, true, true, false]);
    fire(() => checkboxes[2].click());
    const save = container.querySelector<HTMLButtonElement>('.start-button')!;
    expect(save.disabled).toBe(true);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('하나 이상');
    fire(() => checkboxes[3].click());
    expect(save.disabled).toBe(false);
    fire(() => save.click()); await flush();
    expect(saved).toEqual({ tabs: [{ id: 10, modes: ['m1', 'm2'] }, { id: 20, modes: ['m2'] }] });
    expect(container.textContent).toContain('저장했습니다');
  });
  it('keeps edited values on save failure and never reports success', async () => {
    saveFails = true;
    const container = setup(); await flush();
    fire(() => container.querySelectorAll<HTMLInputElement>('input')[1].click());
    fire(() => container.querySelector<HTMLButtonElement>('.start-button')!.click()); await flush();
    expect(container.querySelector('[role=alert]')?.textContent).toBe('저장 실패');
    expect(container.textContent).not.toContain('저장했습니다');
    expect(container.querySelectorAll<HTMLInputElement>('input')[1].checked).toBe(false);
  });
  it('offers retry on loading failure, then renders empty tabs without a save action', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: '조회 실패' }, { status: 500 }));
    const container = setup(); await flush();
    expect(container.textContent).toContain('조회 실패');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ tabs: [] }));
    fire(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '다시 불러오기')!.click());
    await flush();
    expect(container.textContent).toContain('학습 탭이 없습니다');
    expect(container.querySelector('.start-button')).toBeNull();
  });
});
