// 단어 등록 화면 (#49, 단어 등록 시스템 플랜 §5). 붙여넣기 → "확인" 클릭 시
// 기계 검토(JSON/스키마/pinyin-pro/시트 중복) → 검증 테이블 → 탭 선택/생성 →
// (중복 있으면 명시적 확인) → 제출(#48) → 결과 순으로 진행한다. React.lazy로
// 지연 로딩되므로(App.tsx) pinyin-pro는 이 화면에 진입할 때만 받는다.
//
// 검토는 텍스트 입력만으로는 실행되지 않는다(#55) — 붙여넣기/타이핑 중에는
// 결과가 없고, textarea 아래 "확인" 버튼을 눌러야 그 시점의 텍스트로 검증이
// 실행된다. 확인 이후 텍스트를 다시 수정하면(`confirmedText`와 `text`가
// 달라지면) 이전 결과는 무효화되고 재확인 전까지 제출할 수 없다. 탭 선택을
// 바꾸는 것은 이 게이트 밖이라 텍스트는 그대로 둔 채 분류(특히 중복)만 즉시
// 다시 계산된다.
//
// 제출 대상은 valid+duplicate 행 전체다 — blocked 행만 제외한다. 시트 내 중복의
// 최종 스킵 판단은 Worker(#48) 책임(플랜 §2 신뢰 경계)이라, 여기서 표시한
// duplicate 행도 그대로 보내 Worker가 실제로 스킵하게 한다. 중복 확인은
// "중복 집합의 서명(signature)"과 마지막으로 확인한 서명을 비교하는 방식이라,
// 텍스트나 탭이 바뀌어 중복 집합이 달라지면 별도 리셋 코드 없이 자동으로 다시
// 확인을 요구한다.
//
// GET /api/words와 GET /api/tabs 실패를 독립적으로 취급한다: words는 화면 전체를
// 막는 필수 조회(이미 존재하는 엔드포인트라 실패는 진짜 장애)지만, tabs는 #48이
// 아직 없어 항상 실패할 수 있다 — 그 경우 드롭다운 없이 "새 탭" 수동 입력으로
// 대체되며, 중복 대조는 GET /api/words 결과에서 tab 필드로 직접 걸러내므로
// 정확도에 영향이 없다.
import { useEffect, useMemo, useState } from 'react'
import RegisterTable from './RegisterTable.tsx'
import Dropdown from '../components/Dropdown.tsx'
import type { WordEntry } from '../lib/api.ts'
import { fetchWords } from '../lib/wordsApi.ts'
import { fetchTabs, registerWords, type RegisterResult } from '../lib/registerApi.ts'
import { validateNewTabName, validateRegistrationInput } from '../lib/registerValidation.ts'

interface RegisterScreenProps {
  onGoHome: () => void
}

type FetchStatus = 'loading' | 'error' | 'ready'
type SubmitPhase = 'idle' | 'submitting' | 'result'

const NEW_TAB_VALUE = '__new__'

function RegisterScreen({ onGoHome }: RegisterScreenProps) {
  const [wordsStatus, setWordsStatus] = useState<FetchStatus>('loading')
  const [wordsError, setWordsError] = useState('')
  const [allWords, setAllWords] = useState<WordEntry[]>([])
  const [wordsRetryKey, setWordsRetryKey] = useState(0)

  const [tabsStatus, setTabsStatus] = useState<FetchStatus>('loading')
  const [tabs, setTabs] = useState<string[]>([])

  const [selectedTab, setSelectedTab] = useState(NEW_TAB_VALUE)
  const [newTabName, setNewTabName] = useState('')
  const [text, setText] = useState('')
  const [confirmedText, setConfirmedText] = useState<string | null>(null)
  const [acknowledgedDuplicateKey, setAcknowledgedDuplicateKey] = useState<string | null>(null)

  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<RegisterResult | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setWordsStatus('loading')
    fetchWords(controller.signal)
      .then((words) => {
        if (cancelled) return
        setAllWords(words)
        setWordsStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setWordsError(err instanceof Error ? err.message : '단어 목록을 불러오지 못했습니다')
        setWordsStatus('error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [wordsRetryKey])

  // #48(Worker API) 미구현으로 지금은 항상 실패할 수 있다 — 실패해도 화면은 막지
  // 않고 "새 탭" 수동 입력으로 대체한다(아래 tabsStatus 사용부 참고).
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setTabsStatus('loading')
    fetchTabs(controller.signal)
      .then((fetchedTabs) => {
        if (cancelled) return
        setTabs(fetchedTabs)
        setTabsStatus('ready')
        // 사용자가 아직 기본값(새 탭)을 건드리지 않았을 때만 편의상 첫 탭으로 선택.
        setSelectedTab((prev) => (prev === NEW_TAB_VALUE ? fetchedTabs[0] ?? NEW_TAB_VALUE : prev))
      })
      .catch(() => {
        if (cancelled) return
        setTabsStatus('error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const isNewTab = selectedTab === NEW_TAB_VALUE
  const effectiveTab = isNewTab ? newTabName.trim() : selectedTab
  const newTabError = isNewTab ? validateNewTabName(newTabName) : null

  const tabOptions = useMemo(
    () => [...tabs.map((tab) => ({ value: tab, label: tab })), { value: NEW_TAB_VALUE, label: '+ 새 탭' }],
    [tabs],
  )

  const existingHanziInTab = useMemo(
    () => new Set(allWords.filter((word) => word.tab === effectiveTab).map((word) => word.hanzi)),
    [allWords, effectiveTab],
  )

  const isDirty = confirmedText !== null && text !== confirmedText

  const parseResult = useMemo(
    () =>
      confirmedText === null || confirmedText.trim() === ''
        ? null
        : validateRegistrationInput(confirmedText, existingHanziInTab),
    [confirmedText, existingHanziInTab],
  )

  const duplicateRows = parseResult?.ok ? parseResult.rows.filter((row) => row.status === 'duplicate') : []
  const duplicateKey = duplicateRows
    .map((row) => row.hanzi)
    .sort()
    .join(',')
  const hasDuplicates = duplicateKey !== ''
  const duplicatesAcknowledged = !hasDuplicates || acknowledgedDuplicateKey === duplicateKey

  const submittableRows = parseResult?.ok ? parseResult.rows.filter((row) => row.status !== 'blocked') : []
  const validCount = parseResult?.ok ? parseResult.rows.filter((row) => row.status === 'valid').length : 0
  const blockedCount = parseResult?.ok ? parseResult.rows.filter((row) => row.status === 'blocked').length : 0

  const canSubmit =
    submitPhase === 'idle' &&
    !isDirty &&
    parseResult?.ok === true &&
    submittableRows.length > 0 &&
    (!isNewTab || newTabError === null) &&
    duplicatesAcknowledged

  const handleConfirm = () => {
    setConfirmedText(text)
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    setSubmitPhase('submitting')
    setSubmitError(null)
    const createTab = isNewTab && !tabs.includes(effectiveTab)
    registerWords({
      tab: effectiveTab,
      ...(createTab ? { createTab: true } : {}),
      words: submittableRows.map(({ hanzi, pinyin, meaning }) => ({ hanzi, pinyin, meaning })),
    })
      .then((response) => {
        setResult(response)
        setSubmitPhase('result')
      })
      .catch((err: unknown) => {
        setSubmitError(err instanceof Error ? err.message : '등록에 실패했습니다')
        setSubmitPhase('idle')
      })
  }

  if (wordsStatus === 'loading') {
    return (
      <div className="register-screen">
        <RegisterHeader onGoHome={onGoHome} />
        <p className="register-hint">불러오는 중…</p>
      </div>
    )
  }

  if (wordsStatus === 'error') {
    return (
      <div className="register-screen">
        <RegisterHeader onGoHome={onGoHome} />
        <div className="error-card">
          <p className="error-card-title">단어 목록을 불러오지 못했습니다</p>
          <p className="error-card-reason">{wordsError}</p>
          <button type="button" className="retry-fetch-button" onClick={() => setWordsRetryKey((key) => key + 1)}>
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  if (submitPhase === 'result' && result) {
    return (
      <div className="register-screen">
        <RegisterHeader />
        <div className="register-result">
          <p className="register-result-line">
            <strong>{result.tab}</strong>
            {' 탭에 '}
            <span className="register-result-added">{result.added.length}건 추가</span>
            {result.created && ' · 새 탭 생성됨'}
            {result.skipped.length > 0 && (
              <>
                {' · '}
                <span className="register-result-skipped">{result.skipped.length}건 스킵</span>
              </>
            )}
          </p>
        </div>
        <button type="button" className="primary-button" onClick={onGoHome}>
          홈으로
        </button>
      </div>
    )
  }

  return (
    <div className="register-screen">
      <RegisterHeader onGoHome={onGoHome} />

      <div className="register-field">
        <label className="register-field-label" htmlFor="register-textarea">
          스키마 JSON 붙여넣기
        </label>
        <textarea
          id="register-textarea"
          className="register-textarea"
          placeholder='{"version":1,"words":[{"hanzi":"经济","pinyin":"jīngjì","meaning":"경제"}]}'
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          type="button"
          className="register-confirm-button"
          disabled={text.trim() === ''}
          onClick={handleConfirm}
        >
          확인
        </button>
      </div>

      <div className="register-field">
        <label className="register-field-label" htmlFor="register-tab-select">
          등록할 탭
        </label>
        <Dropdown id="register-tab-select" value={selectedTab} options={tabOptions} onChange={setSelectedTab} />
        {tabsStatus === 'error' && (
          <p className="register-hint">탭 목록을 불러오지 못했습니다 — 새 탭 이름을 직접 입력하세요.</p>
        )}
        {isNewTab && (
          <>
            <input
              className="register-new-tab-input"
              type="text"
              placeholder="새 탭 이름"
              value={newTabName}
              onChange={(event) => setNewTabName(event.target.value)}
              autoFocus
            />
            {newTabName !== '' && newTabError && <p className="register-error">{newTabError}</p>}
          </>
        )}
      </div>

      {isDirty && <p className="register-hint">텍스트가 수정되었습니다 — 다시 확인해 주세요.</p>}

      {!isDirty && parseResult && !parseResult.ok && <p className="register-error">{parseResult.error}</p>}

      {!isDirty && parseResult?.ok && (
        <>
          <RegisterTable rows={parseResult.rows} />
          <p className="register-summary">
            정상 {validCount}건 · 오류 {blockedCount}건 · 중복 {duplicateRows.length}건
          </p>

          {hasDuplicates && !duplicatesAcknowledged && (
            <div className="register-confirm-banner">
              <p>중복 {duplicateRows.length}건은 건너뜁니다. 계속하시겠습니까?</p>
              <button
                type="button"
                className="retry-fetch-button"
                onClick={() => setAcknowledgedDuplicateKey(duplicateKey)}
              >
                확인
              </button>
            </div>
          )}

          {submitError && <p className="register-error">{submitError}</p>}

          <button type="button" className="primary-button" disabled={!canSubmit} onClick={handleSubmit}>
            {submitPhase === 'submitting' ? '제출 중…' : '제출'}
          </button>
        </>
      )}
    </div>
  )
}

function RegisterHeader({ onGoHome }: { onGoHome?: () => void }) {
  return (
    <header className="register-header">
      {onGoHome && (
        <button type="button" className="register-back" onClick={onGoHome}>
          홈으로
        </button>
      )}
      <h1 className="register-title">단어 등록</h1>
    </header>
  )
}

export default RegisterScreen
