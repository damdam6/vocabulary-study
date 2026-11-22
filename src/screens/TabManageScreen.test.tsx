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
    if (body.action === 'rename') {
      if (server.some((tab) => tab.name === body.name)) return Response.json({ error: '같은 이름의 탭이 이미 있습니다.' }, { status: 409 });
      server = server.map((tab) => tab.id === body.id ? { ...tab, name: body.name } : tab);
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
    // 해당 탭을 펼친 뒤(이미 펼쳐져 있으면 그대로) 옵션 체크박스 [뜻 보기, 쓰기, 표시]를 돌려준다.
    checks: (name: string) => {
      const item = [...container.querySelectorAll('.tab-manage-item')].find((el) => el.querySelector('.tab-manage-name')?.textContent === name)!;
      const title = item.querySelector<HTMLButtonElement>('.tab-manage-title')!;
      if (title.getAttribute('aria-expanded') !== 'true') fire(() => title.click());
      return [...item.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    },
    metas: () => [...container.querySelectorAll('.tab-manage-meta')].map((el) => el.textContent),
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
  it('lists tab names only, and shows options when a tab is clicked', async () => {
    const ui = await setup();
    expect(ui.names()).toEqual(['단어', '문장', '회화']);
    expect(ui.metas()).toEqual(['12개 · 뜻 보기·쓰기', '3개 · 뜻 보기', '0개 · 쓰기 · 숨김']);
    expect(ui.container.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    expect(ui.checks('단어').map((input) => input.checked)).toEqual([true, true, true]);
    expect(ui.checks('회화').map((input) => input.checked)).toEqual([false, true, false]);
    // 한 번에 한 탭만 펼쳐진다.
    expect(ui.container.querySelectorAll('.tab-manage-panel')).toHaveLength(1);
    fire(() => ui.container.querySelector<HTMLButtonElement>('[aria-expanded=true]')!.click());
    expect(ui.container.querySelectorAll('.tab-manage-panel')).toHaveLength(0);
    expect(ui.save().disabled).toBe(true);
    expect(ui.container.textContent).not.toContain('_정보');
  });

  it('shows hidden tabs at the bottom without changing the saved order', async () => {
    const ui = await setup();
    { const box = ui.checks('단어')[2]; fire(() => box.click()); }      // 단어: 숨김
    expect(ui.names()).toEqual(['문장', '단어', '회화']);
    expect(ui.button('문장 위로').disabled).toBe(true);
    expect(ui.button('문장 아래로').disabled).toBe(true);
    fire(() => ui.save().click()); await flush();
    expect(posts[0].body).toEqual({ action: 'save', tabs: [{ id: 10, modes: ['m1', 'm2'], disabled: true }, { id: 20, modes: ['m1'], disabled: false }, { id: 30, modes: ['m2'], disabled: true }] });
    expect(ui.names()).toEqual(['문장', '단어', '회화']);
  });

  it('saves changed modes, visibility and order in one request without a success message', async () => {
    const ui = await setup();
    { const box = ui.checks('단어')[0]; fire(() => box.click()); }      // 단어: 뜻 보기 끔
    { const box = ui.checks('회화')[2]; fire(() => box.click()); }      // 회화: 다시 표시
    fire(() => ui.button('회화 위로').click());
    expect(ui.names()).toEqual(['단어', '회화', '문장']);
    expect(ui.container.textContent).toContain('저장하지 않은 변경');
    fire(() => ui.save().click()); await flush();
    expect(posts).toEqual([{ path: '/api/tab-manage', body: {
      action: 'save',
      tabs: [{ id: 10, modes: ['m2'], disabled: false }, { id: 30, modes: ['m2'], disabled: false }, { id: 20, modes: ['m1'], disabled: false }],
      order: [10, 30, 20],
    } }]);
    expect(ui.status()).toBeUndefined();
    expect(ui.container.textContent).not.toContain('저장했습니다');
    expect(ui.save().disabled).toBe(true);
  });

  it('leaves untouched default tabs out of the save and omits order when unchanged', async () => {
    const ui = await setup();
    { const box = ui.checks('회화')[2]; fire(() => box.click()); }      // 회화: 다시 표시
    fire(() => ui.save().click()); await flush();
    expect(posts[0].body).toEqual({ action: 'save', tabs: [{ id: 20, modes: ['m1'], disabled: false }, { id: 30, modes: ['m2'], disabled: false }] });
  });

  it('blocks saving a tab with no mode and keeps edits when saving fails', async () => {
    const ui = await setup();
    { const box = ui.checks('문장')[0]; fire(() => box.click()); }
    expect(ui.save().disabled).toBe(true);
    expect(ui.alerts()).toEqual(['유형을 하나 이상 선택하세요.']);
    { const box = ui.checks('문장')[1]; fire(() => box.click()); }
    failNext = '저장 실패';
    fire(() => ui.save().click()); await flush();
    expect(ui.alerts()).toEqual(['저장 실패']);
    expect(ui.checks('문장').map((input) => input.checked)).toEqual([false, true, true]);
    expect(ui.save().disabled).toBe(false);
  });

  it('renames a tab from its options and keeps other unsaved edits', async () => {
    const ui = await setup();
    { const box = ui.checks('단어')[1]; fire(() => box.click()); }
    ui.checks('문장');
    const input = ui.container.querySelector<HTMLInputElement>('.tab-manage-rename input')!;
    expect(input.value).toBe('문장');
    expect(ui.button('이름 변경').disabled).toBe(true);
    fire(() => setNativeValue(input, '_x'));
    expect(ui.button('이름 변경').disabled).toBe(true);
    fire(() => setNativeValue(input, '단어'));
    fire(() => ui.button('이름 변경').click()); await flush();
    expect(ui.alerts()).toEqual(['같은 이름의 탭이 이미 있습니다.']);
    fire(() => setNativeValue(input, ' 긴 문장 '));
    fire(() => ui.button('이름 변경').click()); await flush();
    expect(posts.at(-1)).toEqual({ path: '/api/tab-manage', body: { action: 'rename', id: 20, name: '긴 문장' } });
    expect(ui.names()).toEqual(['단어', '긴 문장', '회화']);
    expect(ui.checks('단어').map((item) => item.checked)).toEqual([true, false, true]);
    expect(ui.save().disabled).toBe(false);
  });

  it('creates a tab without discarding unsaved edits', async () => {
    const ui = await setup();
    { const box = ui.checks('단어')[1]; fire(() => box.click()); }
    const input = ui.container.querySelector<HTMLInputElement>('#tab-manage-new-name')!;
    expect(ui.button('생성').disabled).toBe(true);
    fire(() => setNativeValue(input, '_숨김'));
    expect(ui.button('생성').disabled).toBe(true);
    fire(() => setNativeValue(input, ' HSK7 '));
    fire(() => ui.button('생성').click()); await flush();
    expect(posts[0]).toEqual({ path: '/api/tabs', body: { name: 'HSK7' } });
    expect(ui.names()).toEqual(['단어', '문장', 'HSK7', '회화']);
    expect(ui.checks('단어').map((item) => item.checked)).toEqual([true, false, true]);
    expect(input.value).toBe('');
    expect(ui.status()).toContain('HSK7');
  });

  it('deletes via the trash icon only after confirmation and reports the synced settings', async () => {
    const ui = await setup();
    fire(() => ui.button('문장 삭제').click());
    expect(posts).toEqual([]);
    const confirm = ui.container.querySelector('.tab-manage-confirm')!;
    expect(confirm.textContent).toContain('3개 항목');
    fire(() => ui.button('취소').click());
    expect(ui.container.querySelector('.tab-manage-confirm')).toBeNull();
    expect(posts).toEqual([]);

    fire(() => ui.button('문장 삭제').click());
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
