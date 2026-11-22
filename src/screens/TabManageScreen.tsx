// 탭 관리 화면 — 새 탭 등록, 탭별 출제 유형, 표시 여부(비활성화), 순서, 삭제, 탭 싱크를 한곳에서 다룬다.
//
// 출제 유형·표시 여부·순서는 화면에서 고친 뒤 "설정 저장"으로 한 번에 반영한다(시트 쓰기 횟수를
// 줄이고, 여러 탭을 연달아 고칠 때 매번 기다리지 않게). 생성·삭제·싱크는 누르는 즉시 실행되며,
// 그때도 아직 저장하지 않은 편집은 지우지 않는다 — 서버 목록(baseline)과 편집본(tabs)을 따로 들고
// 생성·삭제된 탭만 양쪽에 반영한다.
import { useEffect, useState } from 'react';
import type { ManagedTab, StudyMode } from '../../shared/studyModes.ts';
import { createTab } from '../lib/registerApi.ts';
import { validateNewTabName } from '../lib/registerValidation.ts';
import { tabManageRequest, type TabSaveEntry } from '../lib/tabManageApi.ts';
import './TabManageScreen.css';

type Busy = 'idle' | 'saving' | 'syncing' | 'creating' | 'deleting';

const MODE_LABELS: Record<StudyMode, string> = { m1: '뜻 보기', m2: '쓰기' };

function sameModes(a: StudyMode[], b: StudyMode[]): boolean {
  return a.length === b.length && a.every((mode) => b.includes(mode));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function TabManageScreen({ onGoHome }: { onGoHome: () => void }) {
  const [tabs, setTabs] = useState<ManagedTab[]>([]);
  const [baseline, setBaseline] = useState<ManagedTab[]>([]);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [newTabName, setNewTabName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadStatus('loading');
    setError('');
    tabManageRequest(undefined, controller.signal).then(({ tabs: fetched }) => {
      if (controller.signal.aborted) return;
      setTabs(fetched);
      setBaseline(fetched);
      setLoadStatus('ready');
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      setError(errorMessage(err, '탭 목록을 불러오지 못했습니다.'));
      setLoadStatus('error');
    });
    return () => controller.abort();
  }, [retry]);

  const baselineById = new Map(baseline.map((tab) => [tab.id, tab]));
  const changedTabs = tabs.filter((tab) => {
    const saved = baselineById.get(tab.id);
    return !saved || saved.disabled !== tab.disabled || !sameModes(saved.modes, tab.modes);
  });
  const orderChanged = tabs.some((tab, index) => baseline[index]?.id !== tab.id);
  const dirty = changedTabs.length > 0 || orderChanged;
  const invalid = tabs.some((tab) => tab.modes.length === 0);
  const working = busy !== 'idle';
  const newTabError = validateNewTabName(newTabName);

  const edit = (update: (previous: ManagedTab[]) => ManagedTab[]) => {
    setNotice('');
    setError('');
    setTabs(update);
  };
  const toggleMode = (id: number, mode: StudyMode) => edit((previous) => previous.map((tab) => tab.id !== id ? tab : {
    ...tab, modes: tab.modes.includes(mode) ? tab.modes.filter((value) => value !== mode) : [...tab.modes, mode],
  }));
  const toggleDisabled = (id: number) => edit((previous) => previous.map((tab) =>
    tab.id !== id ? tab : { ...tab, disabled: !tab.disabled }));
  const move = (index: number, delta: -1 | 1) => edit((previous) => {
    const target = index + delta;
    if (target < 0 || target >= previous.length) return previous;
    const next = [...previous];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  // 즉시 실행 작업 공통 래퍼 — 실패하면 편집본을 그대로 둔 채 오류만 보여준다.
  const run = async (kind: Busy, fallback: string, task: () => Promise<void>) => {
    if (working) return;
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (err: unknown) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy('idle');
    }
  };

  const save = () => run('saving', '설정을 저장하지 못했습니다.', async () => {
    if (invalid || !dirty) return;
    // 이미 명시 설정이 있거나 이번에 바뀐 탭만 보낸다 — 손대지 않은 탭은 프로필 기본 유형을 계속 따른다.
    const entries: TabSaveEntry[] = tabs
      .filter((tab) => tab.explicit || changedTabs.includes(tab))
      .map(({ id, modes, disabled }) => ({ id, modes, disabled }));
    const result = await tabManageRequest({
      action: 'save', tabs: entries, ...(orderChanged ? { order: tabs.map((tab) => tab.id) } : {}),
    });
    setTabs(result.tabs);
    setBaseline(result.tabs);
    setNotice('저장했습니다. 다음 학습부터 적용됩니다.');
  });

  const create = () => run('creating', '탭 생성에 실패했습니다.', async () => {
    if (newTabError !== null) return;
    const { name, created } = await createTab(newTabName.trim());
    const { tabs: fetched } = await tabManageRequest();
    const known = new Set(tabs.map((tab) => tab.id));
    const added = fetched.filter((tab) => !known.has(tab.id));
    setTabs((previous) => [...previous, ...added]);
    setBaseline((previous) => [...previous, ...added]);
    setNewTabName('');
    setNotice(created ? `‘${name}’ 탭을 만들었습니다.` : `‘${name}’ 탭은 이미 있습니다.`);
  });

  const remove = (tab: ManagedTab) => run('deleting', '탭을 삭제하지 못했습니다.', async () => {
    const { removed } = await tabManageRequest({ action: 'delete', id: tab.id });
    setTabs((previous) => previous.filter((entry) => entry.id !== tab.id));
    setBaseline((previous) => previous.filter((entry) => entry.id !== tab.id));
    setConfirmDeleteId(null);
    setNotice(`‘${tab.name}’ 탭을 삭제했습니다.${removed > 0 ? ` 관련 설정 ${removed}건도 정리했습니다.` : ''}`);
  });

  const sync = () => run('syncing', '탭 싱크에 실패했습니다.', async () => {
    const { removed } = await tabManageRequest({ action: 'sync' });
    setNotice(removed > 0 ? `삭제된 탭의 설정 ${removed}건을 정리했습니다.` : '정리할 항목이 없습니다.');
  });

  return <section className="register-screen tab-manage-screen" aria-labelledby="tab-manage-title">
    <header className="register-header">
      <button type="button" className="register-back" onClick={onGoHome} disabled={working}>홈으로</button>
      <h1 id="tab-manage-title" className="register-title">탭 관리</h1>
    </header>

    {loadStatus === 'loading' && <p role="status" className="register-hint">탭 목록을 불러오는 중…</p>}
    {loadStatus === 'error' && <>
      <p role="alert" className="register-error">{error}</p>
      <button type="button" className="register-confirm-button" onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button>
    </>}

    {loadStatus === 'ready' && <>
      <div className="register-field">
        <label className="register-field-label" htmlFor="tab-manage-new-name">새 탭</label>
        <div className="register-new-tab-row">
          <input
            id="tab-manage-new-name"
            className="register-new-tab-input"
            type="text"
            placeholder="새 탭 이름"
            value={newTabName}
            disabled={working}
            onChange={(event) => { setNewTabName(event.target.value); setError(''); }}
          />
          <button type="button" className="register-new-tab-create-button" disabled={newTabError !== null || working} onClick={() => void create()}>
            {busy === 'creating' ? '생성 중…' : '생성'}
          </button>
        </div>
        {newTabName !== '' && newTabError && <p className="register-error">{newTabError}</p>}
      </div>

      <div className="register-field">
        <p className="register-field-label">탭 목록 ({tabs.length})</p>
        <p className="register-hint tab-manage-description">
          출제 유형은 하나 이상 선택하세요. ‘표시’를 끄면 탭과 학습 기록은 남고 홈·학습·등록 화면에서만 숨겨집니다.
        </p>
        {tabs.length === 0 && <p className="register-hint">학습 탭이 없습니다. 위에서 새 탭을 만들어 주세요.</p>}
        <ol className="tab-manage-list">
          {tabs.map((tab, index) => <li key={tab.id} className={`tab-manage-item${tab.disabled ? ' is-disabled' : ''}`}>
            <div className="tab-manage-head">
              <div className="tab-manage-move">
                <button type="button" aria-label={`${tab.name} 위로`} disabled={working || index === 0} onClick={() => move(index, -1)}>▲</button>
                <button type="button" aria-label={`${tab.name} 아래로`} disabled={working || index === tabs.length - 1} onClick={() => move(index, 1)}>▼</button>
              </div>
              <div className="tab-manage-title">
                <span className="tab-manage-name">{tab.name}</span>
                <span className="tab-manage-meta">
                  {tab.wordCount}개{tab.disabled ? ' · 숨김' : ''}{!tab.explicit && sameModes(tab.modes, baselineById.get(tab.id)?.modes ?? []) ? ' · 기본 유형' : ''}
                </span>
              </div>
              <button type="button" className="tab-manage-delete" disabled={working} onClick={() => setConfirmDeleteId(tab.id)}>삭제</button>
            </div>
            <fieldset className="tab-manage-options" disabled={working}>
              <legend className="tab-manage-legend">{tab.name} 설정</legend>
              {(['m1', 'm2'] as const).map((mode) => <label key={mode}>
                <input type="checkbox" checked={tab.modes.includes(mode)} onChange={() => toggleMode(tab.id, mode)} />
                {MODE_LABELS[mode]}
              </label>)}
              <label className="tab-manage-visible">
                <input type="checkbox" checked={!tab.disabled} onChange={() => toggleDisabled(tab.id)} />
                표시
              </label>
            </fieldset>
            {tab.modes.length === 0 && <p className="register-error" role="alert">유형을 하나 이상 선택하세요.</p>}
            {confirmDeleteId === tab.id && <div className="tab-manage-confirm" role="alertdialog" aria-label={`${tab.name} 삭제 확인`}>
              <p>‘{tab.name}’ 탭과 그 안의 {tab.wordCount}개 항목·학습 기록이 시트에서 삭제됩니다. 되돌릴 수 없습니다.</p>
              <div className="tab-manage-confirm-actions">
                <button type="button" className="tab-manage-confirm-delete" disabled={working} onClick={() => void remove(tab)}>
                  {busy === 'deleting' ? '삭제 중…' : '삭제'}
                </button>
                <button type="button" className="register-back" disabled={working} onClick={() => setConfirmDeleteId(null)}>취소</button>
              </div>
            </div>}
          </li>)}
        </ol>
      </div>

      <div className="tab-manage-actions">
        {error && <p role="alert" className="register-error">{error}</p>}
        {notice && <p role="status" className="register-limit-success">{notice}</p>}
        {!error && !notice && dirty && <p className="register-hint">저장하지 않은 변경이 있습니다.</p>}
        <div className="tab-manage-action-row">
          <button type="button" className="register-confirm-button tab-manage-save" disabled={!dirty || invalid || working} onClick={() => void save()}>
            {busy === 'saving' ? '저장 중…' : '설정 저장'}
          </button>
          <button type="button" className="register-back tab-manage-sync" disabled={working} onClick={() => void sync()}>
            {busy === 'syncing' ? '싱크 중…' : '탭 싱크'}
          </button>
        </div>
        <p className="register-hint">탭 싱크는 시트 ‘_정보’ 탭에 남아 있는 삭제된 탭의 설정과 지난 설정 행을 정리합니다.</p>
      </div>
    </>}
  </section>;
}
