// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TabManageScreen from './TabManageScreen.tsx';
import { fire, flush, renderComponent } from '../test-utils.tsx';

interface Tab { id: number; name: string; modes: string[]; explicit: boolean; disabled: boolean; wordCount: number }

let unmount: (() => void) | undefined;
let server: Tab[];
let posts: { path: string; body: any }[];
let failNext: string | null;

beforeEach(() => {
  localStorage.clear(); posts = []; failNext = null;
  server = [
    { id: 10, name: '단어', modes: ['m1', 'm2'], explicit: false, disabled: false, wordCount: 12 },
    { id: 20, name: '문장', modes: ['m1'], explicit: true, disabled: false, wordCount: 3 },
    { id: 30, name: '회화', modes: ['m2'], explicit: true, disabled: true, wordCount: 0 },
  ];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json({ tabs: server });
    const body = JSON.parse(init.body as string);
    posts.push({ path, body });
    if (failNext) { const error = failNext; failNext = null; return Response.json({ error }, { status: 500 }); }
    if (path === '/api/tabs') {
      const existing = server.some((tab) => tab.name === body.name);
      if (!existing) server = [...server, { id: 40, name: body.name, modes: ['m1', 'm2'], explicit: false, disabled: false, wordCount: 0 }];
      return Response.json({ name: body.name, created: !existing });
    }
    if (body.action === 'save') {
      server = server.map((tab) => {
        const entry = body.tabs.find((item: Tab) => item.id === tab.id);
        return entry ? { ...tab, ...entry, explicit: true } : tab;
      });
      if (body.order) server = body.order.map((id: number) => server.find((tab) => tab.id === id)!);
      return Response.json({ tabs: server });
    }
    if (body.action === 'delete') {
      server = server.filter((tab) => tab.id !== body.id);
      return Response.json({ tabs: server, removed: 2 });
    }
    return Response.json({ tabs: server, removed: 3 });
  }));
});
afterEach(() => { unmount?.(); vi.unstubAllGlobals(); });

async function setup() {
  const onGoHome = vi.fn();
  const rendered = renderComponent(<TabManageScreen onGoHome={onGoHome} />);
  unmount = rendered.unmount;
  const { container } = rendered;
  await flush();
  const button = (label: string) => [...container.querySelectorAll('button')].find((el) => el.textContent === label
    || el.getAttribute('aria-label') === label) as HTMLButtonElement;
  return {
    container, button,
    names: () => [...container.querySelectorAll('.tab-manage-name')].map((el) => el.textContent),
    checks: (index: number) => [...container.querySelectorAll('.tab-manage-item')[index].querySelectorAll<HTMLInputElement>('input[type=checkbox]')],
    save: () => container.querySelector<HTMLButtonElement>('.tab-manage-save')!,
    alerts: () => [...container.querySelectorAll('[role=alert]')].map((el) => el.textContent),
    status: () => container.querySelector('.tab-manage-actions [role=status]')?.textContent,
  };
}

function setNativeValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('TabManageScreen', () => {
  it('lists every tab, hidden ones included, with modes, visibility and counts', async () => {
    const ui = await setup();
    expect(ui.names()).toEqual(['단어', '문장', '회화']);
    expect(ui.checks(0).map((input) => input.checked)).toEqual([true, true, true]);
    expect(ui.checks(2).map((input) => input.checked)).toEqual([false, true, false]);
    expect(ui.container.querySelectorAll('.tab-manage-meta')[2].textContent).toBe('0개 · 숨김');
    expect(ui.container.querySelectorAll('.tab-manage-meta')[0].textContent).toBe('12개 · 기본 유형');
    expect(ui.save().disabled).toBe(true);
  });

  it('saves changed modes, visibility and order in one request', async () => {
    const ui = await setup();
    fire(() => ui.checks(0)[0].click());          // 단어: 뜻 보기 끔
    fire(() => ui.checks(1)[2].click());          // 문장: 숨김
    fire(() => ui.button('회화 위로').click());
    expect(ui.names()).toEqual(['단어', '회화', '문장']);
    expect(ui.container.textContent).toContain('저장하지 않은 변경');
    fire(() => ui.save().click()); await flush();
    expect(posts).toEqual([{ path: '/api/tab-manage', body: {
      action: 'save',
      tabs: [{ id: 10, modes: ['m2'], disabled: false }, { id: 30, modes: ['m2'], disabled: true }, { id: 20, modes: ['m1'], disabled: true }],
      order: [10, 30, 20],
    } }]);
    expect(ui.status()).toContain('저장했습니다');
    expect(ui.save().disabled).toBe(true);
  });

  it('leaves untouched default tabs out of the save and omits order when unchanged', async () => {
    const ui = await setup();
    fire(() => ui.checks(2)[2].click());          // 회화: 다시 표시
    fire(() => ui.save().click()); await flush();
    expect(posts[0].body).toEqual({ action: 'save', tabs: [{ id: 20, modes: ['m1'], disabled: false }, { id: 30, modes: ['m2'], disabled: false }] });
  });

  it('blocks saving a tab with no mode and keeps edits when saving fails', async () => {
    const ui = await setup();
    fire(() => ui.checks(1)[0].click());
    expect(ui.save().disabled).toBe(true);
    expect(ui.alerts()).toEqual(['유형을 하나 이상 선택하세요.']);
    fire(() => ui.checks(1)[1].click());
    failNext = '저장 실패';
    fire(() => ui.save().click()); await flush();
    expect(ui.alerts()).toEqual(['저장 실패']);
    expect(ui.checks(1).map((input) => input.checked)).toEqual([false, true, true]);
    expect(ui.save().disabled).toBe(false);
  });

  it('creates a tab without discarding unsaved edits', async () => {
    const ui = await setup();
    fire(() => ui.checks(0)[1].click());
    const input = ui.container.querySelector<HTMLInputElement>('#tab-manage-new-name')!;
    expect(ui.button('생성').disabled).toBe(true);
    fire(() => setNativeValue(input, '_숨김'));
    expect(ui.button('생성').disabled).toBe(true);
    fire(() => setNativeValue(input, ' HSK7 '));
    fire(() => ui.button('생성').click()); await flush();
    expect(posts[0]).toEqual({ path: '/api/tabs', body: { name: 'HSK7' } });
    expect(ui.names()).toEqual(['단어', '문장', '회화', 'HSK7']);
    expect(ui.checks(0).map((item) => item.checked)).toEqual([true, false, true]);
    expect(input.value).toBe('');
    expect(ui.status()).toContain('HSK7');
  });

  it('deletes only after confirmation and reports the synced settings', async () => {
    const ui = await setup();
    fire(() => ui.container.querySelectorAll<HTMLButtonElement>('.tab-manage-delete')[1].click());
    expect(posts).toEqual([]);
    const confirm = ui.container.querySelector('.tab-manage-confirm')!;
    expect(confirm.textContent).toContain('3개 항목');
    fire(() => ui.button('취소').click());
    expect(ui.container.querySelector('.tab-manage-confirm')).toBeNull();
    expect(posts).toEqual([]);

    fire(() => ui.container.querySelectorAll<HTMLButtonElement>('.tab-manage-delete')[1].click());
    fire(() => ui.container.querySelector<HTMLButtonElement>('.tab-manage-confirm-delete')!.click()); await flush();
    expect(posts).toEqual([{ path: '/api/tab-manage', body: { action: 'delete', id: 20 } }]);
    expect(ui.names()).toEqual(['단어', '회화']);
    expect(ui.status()).toContain('관련 설정 2건');
  });

  it('runs tab sync and reports the result', async () => {
    const ui = await setup();
    fire(() => ui.button('탭 싱크').click()); await flush();
    expect(posts).toEqual([{ path: '/api/tab-manage', body: { action: 'sync' } }]);
    expect(ui.status()).toContain('3건을 정리');
  });

  it('offers retry when loading fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: '조회 실패' }, { status: 500 }));
    const ui = await setup();
    expect(ui.alerts()).toEqual(['조회 실패']);
    fire(() => ui.button('다시 불러오기').click()); await flush();
    expect(ui.names()).toHaveLength(3);
  });
});
