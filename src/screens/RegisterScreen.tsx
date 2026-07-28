// 단어 등록 화면 (#49, 단어 등록 시스템 플랜 §5). 탭 선택/생성(#118) → 붙여넣기 →
// "확인" 클릭 시 기계 검토(JSON/스키마/pinyin-pro/시트 중복) → 검증 테이블 →
// (중복 있으면 명시적 확인) → 제출(#48) → 결과 순으로 진행한다. React.lazy로
// 지연 로딩되므로(App.tsx) pinyin-pro는 이 화면에 진입할 때만 받는다.
//
// "+ 새 탭"은 이름 입력만으로는 대상 탭이 되지 않는다(#118) — 입력란 우측 "생성"
// 버튼으로 확정해야 하고, 확정 전(새 탭 모드)에는 제출이 막힌다. 생성 버튼은
// 클릭 시점에 POST /api/tabs로 시트에 실제 탭을 만든다(#120 — 제출 시 생성이던
// 등록 시스템 플랜 §8 Q5 결정을 뒤집음, 빈 탭 감수). 서버 성공 후에만 선택지에
// 추가·선택 전환하며(트림 후 기존 탭과 같으면 Worker가 생성 없이 멱등 성공 —
// 그 탭을 선택), 호출 중에는 버튼이 비활성화되고 실패하면 입력값을 유지한 채
// 입력란 아래 오류 문구를 보여준다. 선택된 탭은 항상 실존하므로 제출 페이로드의
// createTab은 보내지 않는다.
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
//
// 상단의 '문제수' 필드(세션 설정 플랜 §3.5, #110)는 등록 배치와 완전히 분리된
// 자체 상태(limitInput/limitSaveStatus/limitError)로 구현한다 — 필드 저장이
// 아래 등록 플로우(text/confirmedText/submitPhase 등)에 영향을 주지 않고, 역도
// 같다. 현재값은 이 화면이 이미 부르는 fetchWords의 settings에서 오며, 별도
// 표시 없이 입력란을 그 값으로 프리필하는 것으로 "현재값 표시"를 겸한다.
import { useEffect, useMemo, useState } from 'react'
import RegisterTable from './RegisterTable.tsx'
import Dropdown from '../components/Dropdown.tsx'
import { postSettings, type ContentType, type WordEntry } from '../lib/api.ts'
import { registerPlaceholder } from '../lib/contentLabels.ts'
import { fetchWords } from '../lib/wordsApi.ts'
import { createTab, fetchTabs, registerWords, type RegisterResult } from '../lib/registerApi.ts'
import { validateNewTabName, validateRegistrationInput } from '../lib/registerValidation.ts'

interface RegisterScreenProps {
  contentType: ContentType
  onGoHome: () => void
}

type FetchStatus = 'loading' | 'error' | 'ready'
type SubmitPhase = 'idle' | 'submitting' | 'result'
type LimitSaveStatus = 'idle' | 'saving' | 'success'
type TabCreateStatus = 'idle' | 'creating'

const NEW_TAB_VALUE = '__new__'
const MIN_SESSION_LIMIT = 1
const MAX_SESSION_LIMIT = 500

/** 문제수 입력란 클라 선검증(정수 1~500) — 최종 강제는 Worker(#103) 책임. 유효하면 null. */
function validateSessionLimit(rawValue: string): string | null {
  const trimmed = rawValue.trim()
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return '정수를 입력하세요'
  const value = Number(trimmed)
  if (value < MIN_SESSION_LIMIT || value > MAX_SESSION_LIMIT) {
    return `${MIN_SESSION_LIMIT}~${MAX_SESSION_LIMIT} 사이의 값을 입력하세요`
  }
  return null
}

function RegisterScreen({ contentType, onGoHome }: RegisterScreenProps) {
  const [wordsStatus, setWordsStatus] = useState<FetchStatus>('loading')
  const [wordsError, setWordsError] = useState('')
  const [allWords, setAllWords] = useState<WordEntry[]>([])
  const [wordsRetryKey, setWordsRetryKey] = useState(0)

  const [tabsStatus, setTabsStatus] = useState<FetchStatus>('loading')
  const [tabs, setTabs] = useState<string[]>([])

  const [selectedTab, setSelectedTab] = useState(NEW_TAB_VALUE)
  const [newTabName, setNewTabName] = useState('')
  // "생성" 버튼의 POST /api/tabs 호출 상태(#120) — 성공한 탭은 시트에 실존하므로
  // 별도 로컬 목록 없이 tabs 상태에 바로 편입한다.
  const [tabCreateStatus, setTabCreateStatus] = useState<TabCreateStatus>('idle')
  const [tabCreateError, setTabCreateError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [confirmedText, setConfirmedText] = useState<string | null>(null)
  const [acknowledgedDuplicateKey, setAcknowledgedDuplicateKey] = useState<string | null>(null)

  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<RegisterResult | null>(null)

  // 문제수 필드(§3.5) — 등록 배치 상태와 완전히 분리된 자체 상태.
  const [limitInput, setLimitInput] = useState('')
  const [limitSaveStatus, setLimitSaveStatus] = useState<LimitSaveStatus>('idle')
  const [limitError, setLimitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setWordsStatus('loading')
    fetchWords(controller.signal)
      .then(({ words, settings }) => {
        if (cancelled) return
        setAllWords(words)
        setLimitInput(String(settings.sessionLimit))
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
    () => [
      ...tabs.map((tab) => ({ value: tab, label: tab })),
      { value: NEW_TAB_VALUE, label: '+ 새 탭' },
    ],
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
        : validateRegistrationInput(confirmedText, existingHanziInTab, contentType),
    [confirmedText, existingHanziInTab, contentType],
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
    !isNewTab &&
    duplicatesAcknowledged

  const handleConfirm = () => {
    setConfirmedText(text)
  }

  const handleNewTabNameChange = (value: string) => {
    setNewTabName(value)
    setTabCreateError(null)
  }

  // "생성" 클릭 — 그 시점에 Worker가 시트에 실제 탭을 만든다(#120, POST /api/tabs).
  // 서버 성공 후에만 선택지에 편입·선택 전환한다. 트림 후 기존 탭과 같으면 Worker가
  // created: false 멱등 성공을 주므로 같은 경로가 그 탭을 선택하고, 실패하면 입력값을
  // 유지한 채 오류 문구(Worker {error} 본문 우선)를 보여준다.
  const handleCreateTab = () => {
    if (newTabError !== null || tabCreateStatus === 'creating') return
    setTabCreateStatus('creating')
    setTabCreateError(null)
    createTab(newTabName.trim())
      .then(({ name }) => {
        setTabs((prev) => (prev.includes(name) ? prev : [...prev, name]))
        setSelectedTab(name)
        setNewTabName('')
        setTabCreateStatus('idle')
      })
      .catch((err: unknown) => {
        setTabCreateError(err instanceof Error ? err.message : '탭 생성에 실패했습니다')
        setTabCreateStatus('idle')
      })
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    setSubmitPhase('submitting')
    setSubmitError(null)
    // 선택된 탭은 항상 실존한다(생성 버튼이 사전 생성, #120) — createTab은 보내지 않는다.
    registerWords({
      tab: effectiveTab,
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

  const limitValidationError = validateSessionLimit(limitInput)
  const canSaveLimit = limitSaveStatus !== 'saving' && limitValidationError === null
  // 클라 선검증 오류가 서버 저장 실패 문구보다 우선한다 — 값을 고치는 순간 서버
  // 오류는 handleLimitInputChange가 지우므로 둘이 동시에 존재할 일은 없다.
  const displayedLimitError = limitValidationError ?? limitError

  const handleLimitInputChange = (value: string) => {
    setLimitInput(value)
    setLimitError(null)
    setLimitSaveStatus('idle')
  }

  const handleSaveLimit = () => {
    setLimitSaveStatus('saving')
    setLimitError(null)
    postSettings(Number(limitInput))
      .then((settings) => {
        setLimitInput(String(settings.sessionLimit))
        setLimitSaveStatus('success')
      })
      .catch((err: unknown) => {
        setLimitError(err instanceof Error ? err.message : '저장에 실패했습니다')
        setLimitSaveStatus('idle')
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

      <div className="register-field register-limit-field">
        <label className="register-field-label" htmlFor="register-limit-input">
          1회 문제 수
        </label>
        <div className="register-limit-row">
          <input
            id="register-limit-input"
            className="register-limit-input"
            type="number"
            inputMode="numeric"
            min={MIN_SESSION_LIMIT}
            max={MAX_SESSION_LIMIT}
            value={limitInput}
            onChange={(event) => handleLimitInputChange(event.target.value)}
          />
          <button
            type="button"
            className="register-limit-save-button"
            disabled={!canSaveLimit}
            onClick={handleSaveLimit}
          >
            {limitSaveStatus === 'saving' ? '저장 중…' : '저장'}
          </button>
        </div>
        {displayedLimitError && <p className="register-error">{displayedLimitError}</p>}
        {!displayedLimitError && limitSaveStatus === 'success' && (
          <p className="register-limit-success">저장되었습니다</p>
        )}
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
            <div className="register-new-tab-row">
              <input
                className="register-new-tab-input"
                type="text"
                placeholder="새 탭 이름"
                value={newTabName}
                onChange={(event) => handleNewTabNameChange(event.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="register-new-tab-create-button"
                disabled={newTabError !== null || tabCreateStatus === 'creating'}
                onClick={handleCreateTab}
              >
                {tabCreateStatus === 'creating' ? '생성 중…' : '생성'}
              </button>
            </div>
            {newTabName !== '' && newTabError && <p className="register-error">{newTabError}</p>}
            {tabCreateError && <p className="register-error">{tabCreateError}</p>}
          </>
        )}
      </div>

      <div className="register-field">
        <label className="register-field-label" htmlFor="register-textarea">
          스키마 JSON 붙여넣기
        </label>
        <textarea
          id="register-textarea"
          className="register-textarea"
          placeholder={registerPlaceholder(contentType)}
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

      {isDirty && <p className="register-hint">텍스트가 수정되었습니다 — 다시 확인해 주세요.</p>}

      {!isDirty && parseResult && !parseResult.ok && <p className="register-error">{parseResult.error}</p>}

      {!isDirty && parseResult?.ok && (
        <>
          <RegisterTable rows={parseResult.rows} contentType={contentType} />
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
