// 단어 등록 화면 (#49, 단어 등록 시스템 플랜 §5). 탭 선택 → 붙여넣기 →
// "확인" 클릭 시 기계 검토(JSON/스키마/pinyin-pro/시트 중복) → 검증 테이블 →
// (중복 있으면 명시적 확인) → 제출(#48) → 결과 순으로 진행한다. React.lazy로
// 지연 로딩되므로(App.tsx) pinyin-pro는 이 화면에 진입할 때만 받는다.
//
// 탭 선택은 별도 단계다 — 진입하면 탭 목록 전체가 한 화면에 나열되고(탭이 많으면
// 드롭다운이 불편하다), 하나를 고르면 등록 폼으로 넘어간다. 폼의 "탭 변경"으로
// 목록에 돌아와도 붙여넣은 텍스트·검토 결과·편집은 그대로 남는다. 새 탭 만들기는
// 탭 관리 화면(TabManageScreen)으로 옮겼고, 목록에는 숨김(비활성) 탭이 나오지 않는다.
// 선택된 탭은 항상 실존하므로 제출 페이로드의 createTab은 보내지 않는다.
//
// 검토는 텍스트 입력만으로는 실행되지 않는다(#55) — 붙여넣기/타이핑 중에는
// 결과가 없고, textarea 아래 "확인" 버튼을 눌러야 그 시점의 텍스트로 검증이
// 실행된다. 확인 이후 텍스트를 다시 수정하면(`confirmedText`와 `text`가
// 달라지면) 이전 결과는 무효화되고 재확인 전까지 제출할 수 없다. 탭 선택을
// 바꾸는 것은 이 게이트 밖이라 텍스트는 그대로 둔 채 분류(특히 중복)만 즉시
// 다시 계산된다.
//
// blocked(오류) 행은 조용히 빠지지 않는다(#127) — 오류 배너가 뜨고, "오류 수정" 버튼이 여는 모달에서 행마다 세 값을 고칠 수 있다. 편집값은
// #174 경고도 같은 편집 경로를 사용한다. 원본 텍스트를 건드리지 않고 별도 오버레이(행 index → 편집값)에 담기므로 위의 isDirty
// 게이트가 걸리지 않는다. 파생은 2단이다: 파싱(confirmedText 의존) → 오버레이 덮어쓰기 →
// 분류(선택 탭 의존). 그래서 탭만 바꾸면 분류만 다시 돌고 편집은 살아남고, 텍스트를 고쳐
// 재확인하면(행 구성이 달라져 index가 어긋나므로) 오버레이를 비운다. 오버레이에 키가
// 있다는 것 자체가 "원본과 다르다"는 뜻이라 '직접수정' 태그의 근거로 그대로 쓴다 —
// 저장 시 원본과 같아진 행은 엔트리를 지워 플래그가 어긋날 여지를 없앤다.
//
// 제출 대상은 valid+warning+duplicate 행 전체다 — blocked 행만 제외한다. 시트 내 중복의
// 최종 스킵 판단은 Worker(#48) 책임(플랜 §2 신뢰 경계)이라, 여기서 표시한
// duplicate 행도 그대로 보내 Worker가 실제로 스킵하게 한다. 중복 확인은
// "중복 집합의 서명(signature)"과 마지막으로 확인한 서명을 비교하는 방식이라,
// 텍스트나 탭이 바뀌어 중복 집합이 달라지면 별도 리셋 코드 없이 자동으로 다시
// 확인을 요구한다.
//
// GET /api/words와 GET /api/tabs는 둘 다 필수 조회다: words는 시트 중복 대조에,
// tabs는 등록 대상 선택에 쓰인다. tabs가 실패하면 탭 선택 단계에서 다시 시도한다.
//
// 상단의 '문제수' 필드(세션 설정 플랜 §3.5, #110)는 등록 배치와 완전히 분리된
// 자체 상태(limitInput/limitSaveStatus/limitError)로 구현한다 — 필드 저장이
// 아래 등록 플로우(text/confirmedText/submitPhase 등)에 영향을 주지 않고, 역도
// 같다. 현재값은 이 화면이 이미 부르는 fetchWords의 settings에서 오며, 별도
// 표시 없이 입력란을 그 값으로 프리필하는 것으로 "현재값 표시"를 겸한다.
import { useEffect, useMemo, useState } from 'react'
import { validateZhRegistrationWord } from '../../shared/registration.ts'
import RegisterErrorModal, { type EditableRow } from './RegisterErrorModal.tsx'
import RegisterTable from './RegisterTable.tsx'
import { postSettings, type ContentType, type WordEntry } from '../lib/api.ts'
import { registerPlaceholder } from '../lib/contentLabels.ts'
import { fetchWords } from '../lib/wordsApi.ts'
import { fetchTabs, registerWords, type RegisterResult } from '../lib/registerApi.ts'
import {
  classifyRegistrationRows,
  parseRegistrationInput,
  type ParsedWord,
} from '../lib/registerValidation.ts'

interface RegisterScreenProps {
  contentType: ContentType
  onGoHome: () => void
  /** 탭 선택 단계의 "탭 관리" 이동. 없으면 버튼을 숨긴다. */
  onNavigateTabs?: () => void
}

type FetchStatus = 'loading' | 'error' | 'ready'
type SubmitPhase = 'idle' | 'submitting' | 'result'
type LimitSaveStatus = 'idle' | 'saving' | 'success'

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

function RegisterScreen({ contentType, onGoHome, onNavigateTabs }: RegisterScreenProps) {
  const [wordsStatus, setWordsStatus] = useState<FetchStatus>('loading')
  const [wordsError, setWordsError] = useState('')
  const [allWords, setAllWords] = useState<WordEntry[]>([])
  const [wordsRetryKey, setWordsRetryKey] = useState(0)

  const [tabsStatus, setTabsStatus] = useState<FetchStatus>('loading')
  const [tabs, setTabs] = useState<string[]>([])

  const [tabsRetryKey, setTabsRetryKey] = useState(0)

  // null이면 탭 선택 단계, 값이 있으면 그 탭의 등록 폼.
  const [selectedTab, setSelectedTab] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [confirmedText, setConfirmedText] = useState<string | null>(null)
  const [acknowledgedDuplicateKey, setAcknowledgedDuplicateKey] = useState<string | null>(null)
  // 오류 행 직접 수정(#127) — 행 index → 편집값. 키가 있다 = 원본과 다르다('직접수정').
  const [editOverlay, setEditOverlay] = useState<Record<number, ParsedWord>>({})
  const [editMode, setEditMode] = useState<'blocked' | 'warning' | null>(null)

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

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setTabsStatus('loading')
    fetchTabs(controller.signal)
      .then((fetchedTabs) => {
        if (cancelled) return
        setTabs(fetchedTabs)
        setTabsStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setTabsStatus('error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [tabsRetryKey])

  const effectiveTab = selectedTab ?? ''

  const wordCountByTab = useMemo(() => {
    const counts = new Map<string, number>()
    for (const word of allWords) counts.set(word.tab, (counts.get(word.tab) ?? 0) + 1)
    return counts
  }, [allWords])

  const existingHanziInTab = useMemo(
    () => new Set(allWords.filter((word) => word.tab === effectiveTab).map((word) => word.hanzi)),
    [allWords, effectiveTab],
  )

  const isDirty = confirmedText !== null && text !== confirmedText

  // 1단: 파싱 — 텍스트에만 의존한다. 탭을 바꿔도 다시 돌지 않으므로 오버레이의 index가
  // 가리키는 행 구성이 유지된다.
  const parseResult = useMemo(
    () =>
      confirmedText === null || confirmedText.trim() === ''
        ? null
        : parseRegistrationInput(confirmedText, contentType),
    [confirmedText, contentType],
  )

  // 2단: 오버레이를 덮어쓴 값으로 분류 — 선택 탭(시트 중복)까지 여기서 반영된다.
  const rows = useMemo(() => {
    if (!parseResult?.ok) return []
    const effectiveWords = parseResult.words.map((word, index) => editOverlay[index] ?? word)
    return classifyRegistrationRows(effectiveWords, existingHanziInTab, contentType)
  }, [parseResult, editOverlay, existingHanziInTab, contentType])

  const duplicateRows = rows.filter((row) => row.status === 'duplicate')
  const duplicateKey = JSON.stringify([effectiveTab, duplicateRows.map((row) => row.hanzi).sort()])
  const hasDuplicates = duplicateRows.length > 0
  const duplicatesAcknowledged = !hasDuplicates || acknowledgedDuplicateKey === duplicateKey

  const submittableRows = rows.filter((row) => row.status !== 'blocked')
  const validCount = rows.filter((row) => row.status === 'valid').length
  const warningCount = rows.filter((row) => row.status === 'warning').length
  const warningRows: EditableRow[] = rows.map((row, index) => ({ index, row })).filter(({ row }) => row.warnings?.length)
  const blockedRows: EditableRow[] = rows
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => row.status === 'blocked')
  const editingRows = editMode === 'warning' ? warningRows : blockedRows
  const blockedCount = blockedRows.length
  const editedIndexes = useMemo(
    () => new Set(Object.keys(editOverlay).map(Number)),
    [editOverlay],
  )

  const canSubmit =
    submitPhase === 'idle' &&
    !isDirty &&
    parseResult?.ok === true &&
    submittableRows.length > 0 &&
    selectedTab !== null &&
    duplicatesAcknowledged

  // 텍스트가 실제로 달라진 재확인만 오버레이를 버린다 — 행 구성이 바뀌어 index 기반
  // 오버레이가 어긋나기 때문. 같은 텍스트로 다시 눌렀을 때 편집이 통째로 날아가지는 않는다.
  const handleConfirm = () => {
    if (text !== confirmedText) setEditOverlay({})
    setConfirmedText(text)
  }

  // 모달의 표시값과 같으면 현재 오버레이를 그대로 둔다. 정규화만으로 수정 태그를 붙이지 않는다.
  // 실제 변경은 형식 검사를 통과한 원본 표시값과 비교하여 되돌리기를 판별한다.
  // 불허 문자가 있는 원본/편집값을 비교 전에 trim·NFC로 덮어쓰지 않는다.
  const handleErrorEditsSave = (edits: Record<number, ParsedWord>) => {
    if (parseResult?.ok) {
      const originals = parseResult.words
      setEditOverlay((prev) => {
        const next = { ...prev }
        for (const [key, edited] of Object.entries(edits)) {
          const index = Number(key)
          const original = originals[index]
          const preserved: ParsedWord = {
            hanzi: contentType === 'zh' ? edited.hanzi : edited.hanzi.trim(),
            pinyin: contentType === 'zh' ? edited.pinyin : edited.pinyin.trim(),
            meaning: edited.meaning.trim(),
          }
          const sameValues = (value: ParsedWord | undefined) => value !== undefined &&
            preserved.hanzi === value.hanzi &&
            preserved.pinyin === value.pinyin &&
            preserved.meaning === value.meaning
          if (sameValues(rows[index])) continue
          const originalValidation = contentType === 'zh' ? validateZhRegistrationWord(original) : null
          const baseline = originalValidation?.ok ? originalValidation.word : original
          if (sameValues(baseline)) delete next[index]
          else next[index] = preserved
        }
        return next
      })
    }
    setEditMode(null)
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    setSubmitPhase('submitting')
    setSubmitError(null)
    // 선택된 탭은 항상 실존한다(목록에서 고른 탭) — createTab은 보내지 않는다.
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
        <RegisterHeader onGoHome={onGoHome} contentType={contentType} />
        <p className="register-hint">불러오는 중…</p>
      </div>
    )
  }

  if (wordsStatus === 'error') {
    return (
      <div className="register-screen">
        <RegisterHeader onGoHome={onGoHome} contentType={contentType} />
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
        <RegisterHeader contentType={contentType} />
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

  if (selectedTab === null) {
    return (
      <div className="register-screen">
        <RegisterHeader onGoHome={onGoHome} contentType={contentType} />
        <div className="register-field">
          <p className="register-field-label">등록할 탭을 선택하세요</p>
          {tabsStatus === 'loading' && <p className="register-hint">탭 목록을 불러오는 중…</p>}
          {tabsStatus === 'error' && (
            <>
              <p className="register-error">탭 목록을 불러오지 못했습니다.</p>
              <button type="button" className="retry-fetch-button" onClick={() => setTabsRetryKey((key) => key + 1)}>
                다시 시도
              </button>
            </>
          )}
          {tabsStatus === 'ready' && tabs.length === 0 && (
            <p className="register-hint">등록할 수 있는 탭이 없습니다. 탭 관리에서 새 탭을 만들어 주세요.</p>
          )}
          {tabsStatus === 'ready' && tabs.length > 0 && (
            <ul className="register-tab-list">
              {tabs.map((tab) => (
                <li key={tab}>
                  <button type="button" className="register-tab-item" onClick={() => setSelectedTab(tab)}>
                    <span className="register-tab-item-name">{tab}</span>
                    <span className="register-tab-item-count">{wordCountByTab.get(tab) ?? 0}개</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {onNavigateTabs && (
          <div className="register-tab-manage">
            <p className="register-hint">새 탭 추가·숨김·순서 변경은 탭 관리에서 할 수 있습니다.</p>
            <button type="button" className="register-back" onClick={onNavigateTabs}>
              탭 관리
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="register-screen">
      <RegisterHeader onGoHome={onGoHome} contentType={contentType} />

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
        <p className="register-field-label">등록할 탭</p>
        <div className="register-tab-current">
          <span className="register-tab-current-name">{selectedTab}</span>
          <button type="button" className="register-back register-tab-change" onClick={() => setSelectedTab(null)}>
            탭 변경
          </button>
        </div>
      </div>

      <div className="register-field">
        <label className="register-field-label" htmlFor="register-textarea">
          스키마 JSON 붙여넣기
        </label>
        {contentType === 'zh' && <p className="register-hint">단어·문장 원문과 병음·뜻을 입력하세요. 원문은 200자, 병음은 1,000자, 한 번에 100건까지 등록할 수 있습니다.</p>}
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
          <RegisterTable rows={rows} contentType={contentType} editedIndexes={editedIndexes} />
          <p className="register-summary">
            정상 {validCount}건 · 경고 {warningCount}건 · 오류 {blockedCount}건 · 중복 {duplicateRows.length}건
            {' · 전송 '}{submittableRows.length}건 (중복은 서버에서 건너뜁니다)
          </p>

          {/* 오류 배너(#127) — dismiss 없이 blocked가 0이 되면 사라지고, 제출은 막지 않는다. */}
          {blockedCount > 0 && (
            <div className="register-error-banner">
              <p>오류 {blockedCount}건은 등록되지 않습니다.</p>
              <button
                type="button"
                className="register-error-fix-button"
                onClick={() => setEditMode('blocked')}
              >
                오류 수정
              </button>
            </div>
          )}

          {warningRows.length > 0 && (
            <div className="register-warning-banner">
              <p>병음 검토 {warningRows.length}건{duplicateRows.some((row) => row.warnings?.length) ? ' (중복 포함)' : ''}은 그대로 제출할 수 있습니다. 자동 검토는 발음 정확성을 보증하지 않습니다.</p>
              <button type="button" className="register-warning-fix-button" onClick={() => setEditMode('warning')}>
                병음 검토·수정
              </button>
            </div>
          )}

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

          {editMode && editingRows.length > 0 && (
            <RegisterErrorModal
              rows={editingRows}
              kind={editMode}
              contentType={contentType}
              onCancel={() => setEditMode(null)}
              onSave={handleErrorEditsSave}
            />
          )}
        </>
      )}
    </div>
  )
}

function RegisterHeader({ onGoHome, contentType }: { onGoHome?: () => void; contentType: ContentType }) {
  return (
    <header className="register-header">
      {onGoHome && (
        <button type="button" className="register-back" onClick={onGoHome}>
          홈으로
        </button>
      )}
      <h1 className="register-title">{contentType === 'zh' ? '단어·문장 등록' : '단어 등록'}</h1>
    </header>
  )
}

export default RegisterScreen
