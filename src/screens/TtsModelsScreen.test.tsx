// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { fire, flush, renderComponent } from '../test-utils.tsx';
import TtsModelsScreen from './TtsModelsScreen.tsx';
import { ttsModelsRequest } from '../lib/ttsModelsApi.ts';
import { TTS_MODELS } from '../../shared/ttsModels.ts';
vi.mock('../lib/ttsModelsApi.ts', () => ({ ttsModelsRequest: vi.fn() }));
let unmount: (() => void) | undefined;
afterEach(() => { unmount?.(); vi.resetAllMocks(); });
it('shows four radios, saves exactly one and keeps the selection after a failed save', async () => {
  vi.mocked(ttsModelsRequest).mockResolvedValueOnce(TTS_MODELS[0]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(TTS_MODELS[2]);
  const view = renderComponent(<TtsModelsScreen onGoHome={() => {}} />); unmount = view.unmount;
  await flush();
  const radios = [...view.container.querySelectorAll<HTMLInputElement>('input[type=radio]')];
  expect(radios).toHaveLength(4); expect(radios.filter((r) => r.checked)).toHaveLength(1);
  fire(() => radios[2]!.click());
  const save = () => [...view.container.querySelectorAll('button')].find((b) => b.textContent === '저장')!;
  fire(() => save().click()); await flush();
  expect(view.container.querySelector('[role=alert]')?.textContent).toContain('저장하지 못했습니다');
  expect(radios[2]!.checked).toBe(true);
  fire(() => save().click()); await flush();
  expect(ttsModelsRequest).toHaveBeenLastCalledWith(TTS_MODELS[2]);
  expect(view.container.querySelector('[role=status]')?.textContent).toContain('저장했습니다');
});
it('offers retry after loading fails', async () => {
  vi.mocked(ttsModelsRequest).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(TTS_MODELS[1]);
  const view = renderComponent(<TtsModelsScreen onGoHome={() => {}} />); unmount = view.unmount;
  await flush();
  fire(() => [...view.container.querySelectorAll('button')].find((b) => b.textContent === '다시 불러오기')!.click());
  await flush();
  expect(view.container.querySelector<HTMLInputElement>(`input[value="${TTS_MODELS[1]}"]`)?.checked).toBe(true);
});
