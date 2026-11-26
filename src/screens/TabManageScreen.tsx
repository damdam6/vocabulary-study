// 탭 관리 화면 — 새 탭 등록, 이름 변경, 탭별 출제 유형, 표시 여부(비활성화), 순서, 삭제, 탭 싱크를 한곳에서 다룬다.
//
// 목록은 탭 이름만 한 줄씩 보여주고, 탭을 누르면 그 탭의 옵션(이름·출제 유형·표시)이 펼쳐진다.
// 표시를 끈 탭은 이 화면에서만 목록 아래쪽으로 모아 보여준다 — 시트의 실제 순서는 바꾸지 않는다.
//
// 출제 유형·표시 여부·순서는 화면에서 고친 뒤 "설정 저장"으로 한 번에 반영한다(시트 쓰기 횟수를
// 줄이고, 여러 탭을 연달아 고칠 때 매번 기다리지 않게). 생성·이름 변경·삭제·싱크는 누르는 즉시 실행되며,
// 그때도 아직 저장하지 않은 편집은 지우지 않는다 — 서버 목록(baseline)과 편집본(tabs)을 따로 들고
// 생성·삭제된 탭만 양쪽에 반영한다.
import { useEffect, useState } from 'react';
import type { ManagedTab, StudyMode } from '../../shared/studyModes.ts';
import { createTab } from '../lib/registerApi.ts';
import { validateNewTabName } from '../lib/registerValidation.ts';
import { tabManageRequest, type TabSaveEntry } from '../lib/tabManageApi.ts';
import './TabManageScreen.css';
import HomeIcon from '../components/HomeIcon.tsx';

type Busy = 'idle' | 'saving' | 'syncing' | 'creating' | 'renaming' | 'deleting';

const MODE_LABELS: Record<StudyMode, string> = { m1: '뜻 보기', m2: '쓰기' };

function sameModes(a: StudyMode[], b: StudyMode[]): boolean {
  return a.length === b.length && a.every((mode) => b.includes(mode));
}

// 아이콘은 인라인 SVG 자체 제작(HomeUtilBar와 같은 규칙) — stroke는 currentColor.
function TrashIcon() {
  return (
    <svg className="tab-manage-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

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
  // 표시 중인 탭 먼저, 숨긴 탭은 아래로 — 화면 표시 순서일 뿐 저장되는 순서(tabs)는 그대로다.
  const displayed = [...tabs.filter((tab) => !tab.disabled), ...tabs.filter((tab) => tab.disabled)];
  // 같은 묶음(표시/숨김) 안의 이웃과 자리를 바꾼다. 없으면 null.
  const neighbor = (tab: ManagedTab, delta: -1 | 1): ManagedTab | null => {
    const other = displayed[displayed.indexOf(tab) + delta];
    return other && other.disabled === tab.disabled ? other : null;
  };
  const move = (tab: ManagedTab, delta: -1 | 1) => {
    const other = neighbor(tab, delta);
    if (!other) return;
    edit((previous) => previous.map((entry) => entry.id === tab.id ? other : entry.id === other.id ? tab : entry));
  };
  const toggleExpanded = (tab: ManagedTab) => {
    setExpandedId(expandedId === tab.id ? null : tab.id);
    setRenameDraft(tab.name);
  };

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
  });

  const create = () => run('creating', '탭 생성에 실패했습니다.', async () => {
    if (newTabError !== null) return;
    const { name, created } = await createTab(newTabName.trim());
    const { tabs: fetched } = await tabManageRequest();
    const known = new Set(tabs.map((tab) => tab.id));
    const added = fetched.filter((tab) => !known.has(tab.id));
    // 시트에서 새 탭은 맨 앞에 생기므로 목록에서도 최상단에 둔다.
    setTabs((previous) => [...added, ...previous]);
    setBaseline((previous) => [...added, ...previous]);
    setNewTabName('');
    setNotice(created ? `‘${name}’ 탭을 만들었습니다.` : `‘${name}’ 탭은 이미 있습니다.`);
  });

  const rename = (tab: ManagedTab) => run('renaming', '탭 이름을 바꾸지 못했습니다.', async () => {
    const result = await tabManageRequest({ action: 'rename', id: tab.id, name: renameDraft.trim() });
    const name = result.tabs.find((entry) => entry.id === tab.id)?.name ?? renameDraft.trim();
    const apply = (previous: ManagedTab[]) => previous.map((entry) => entry.id === tab.id ? { ...entry, name } : entry);
    setTabs(apply);
    setBaseline(apply);
    setRenameDraft(name);
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
      <button type="button" className="register-back" aria-label="홈으로" title="홈으로" onClick={onGoHome} disabled={working}><HomeIcon /></button>
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
        {tabs.length === 0 && <p className="register-hint">학습 탭이 없습니다. 위에서 새 탭을 만들어 주세요.</p>}
        <ol className="tab-manage-list">
          {displayed.map((tab) => {
            const expanded = expandedId === tab.id;
            const renameError = validateNewTabName(renameDraft);
            return <li key={tab.id} className={`tab-manage-item${tab.disabled ? ' is-disabled' : ''}`}>
            <div className="tab-manage-head">
              <div className="tab-manage-move">
                <button type="button" aria-label={`${tab.name} 위로`} disabled={working || !neighbor(tab, -1)} onClick={() => move(tab, -1)}>▲</button>
                <button type="button" aria-label={`${tab.name} 아래로`} disabled={working || !neighbor(tab, 1)} onClick={() => move(tab, 1)}>▼</button>
              </div>
              <button type="button" className="tab-manage-title" aria-expanded={expanded} onClick={() => toggleExpanded(tab)}>
                <span className="tab-manage-name">{tab.name}</span>
                <span className="tab-manage-meta">
                  {tab.wordCount}개 · {tab.modes.map((mode) => MODE_LABELS[mode]).join('·') || '유형 없음'}{tab.disabled ? ' · 숨김' : ''}
                </span>
              </button>
              <button type="button" className="tab-manage-delete" aria-label={`${tab.name} 삭제`} disabled={working} onClick={() => setConfirmDeleteId(tab.id)}>
                <TrashIcon />
              </button>
            </div>
            {expanded && <div className="tab-manage-panel">
              <div className="tab-manage-rename">
                <input
                  className="register-new-tab-input"
                  type="text"
                  aria-label={`${tab.name} 탭 이름`}
                  value={renameDraft}
                  disabled={working}
                  onChange={(event) => { setRenameDraft(event.target.value); setError(''); }}
                />
                <button type="button" className="register-back tab-manage-rename-button" disabled={working || renameError !== null || renameDraft.trim() === tab.name} onClick={() => void rename(tab)}>
                  {busy === 'renaming' ? '변경 중…' : '이름 변경'}
                </button>
              </div>
              {renameError && <p className="register-error">{renameError}</p>}
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
            </div>}
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
          </li>;
          })}
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
      </div>
    </>}
  </section>;
}
