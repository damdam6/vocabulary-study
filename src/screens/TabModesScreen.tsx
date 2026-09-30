import { useEffect, useState } from 'react';
import type { StudyMode, TabModeSetting } from '../../shared/studyModes.ts';
import { tabModesRequest } from '../lib/tabModesApi.ts';
import './TabModesScreen.css';

export default function TabModesScreen({ onGoHome }: { onGoHome: () => void }) {
  const [tabs, setTabs] = useState<TabModeSetting[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'saving'>('loading');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setMessage('');
    tabModesRequest(undefined, controller.signal).then((fetched) => {
      if (controller.signal.aborted) return;
      setTabs(fetched);
      setStatus('ready');
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : '설정을 불러오지 못했습니다.');
      setStatus('error');
    });
    return () => controller.abort();
  }, [retry]);

  const toggle = (id: number, mode: StudyMode) => {
    setSaved(false);
    setMessage('');
    setTabs((previous) => previous.map((tab) => tab.id !== id ? tab : {
      ...tab, modes: tab.modes.includes(mode) ? tab.modes.filter((value) => value !== mode) : [...tab.modes, mode],
    }));
  };
  const invalid = tabs.some((tab) => tab.modes.length === 0);
  const save = async () => {
    if (invalid || status !== 'ready') return;
    setStatus('saving');
    setMessage('');
    setSaved(false);
    try {
      const updated = await tabModesRequest(tabs.map(({ id, modes }) => ({ id, modes })));
      setTabs(updated);
      setSaved(true);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '설정을 저장하지 못했습니다.');
    } finally { setStatus('ready'); }
  };

  return <section className="register-screen tab-modes-screen" aria-labelledby="tab-modes-title">
    <header className="register-header">
      <button type="button" className="register-back" onClick={onGoHome} disabled={status === 'saving'}>홈으로</button>
      <h1 id="tab-modes-title" className="register-title">탭별 출제 유형</h1>
    </header>
    <p className="register-hint tab-modes-description">탭마다 출제할 유형을 하나 이상 선택하세요.<br />변경한 설정은 다음 학습부터 적용되며, 학습 기록은 유지됩니다.</p>
    {status === 'loading' && <p role="status" className="register-hint">설정을 불러오는 중…</p>}
    {message && <p role="alert" className="register-error">{message}</p>}
    {status === 'error' && <button type="button" className="register-confirm-button" onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button>}
    {(status === 'ready' || status === 'saving') && <>
      {tabs.length === 0 && <p className="register-hint">학습 탭이 없습니다. 홈에서 단어를 등록해 주세요.</p>}
      {tabs.map((tab) => <fieldset key={tab.id} disabled={status === 'saving'} className="tab-modes-tab">
        <legend className="register-field-label">{tab.name}</legend>
        <div className="tab-modes-options">
          {(['m1', 'm2'] as const).map((mode) => <label key={mode}>
            <input type="checkbox" checked={tab.modes.includes(mode)} onChange={() => toggle(tab.id, mode)} />
            {mode === 'm1' ? '뜻 보기' : '쓰기'}
          </label>)}
        </div>
        {!tab.explicit && <p className="register-hint">프로필 기본 유형 사용 중</p>}
        {tab.modes.length === 0 && <p className="register-error" role="alert">유형을 하나 이상 선택하세요.</p>}
      </fieldset>)}
      {saved && <p role="status" className="register-limit-success">저장했습니다. 다음 학습부터 적용됩니다.</p>}
      {tabs.length > 0 && <button type="button" className="register-confirm-button tab-modes-save" disabled={invalid || status === 'saving'} onClick={() => void save()}>
        {status === 'saving' ? '저장 중…' : '설정 저장'}
      </button>}
    </>}
  </section>;
}
