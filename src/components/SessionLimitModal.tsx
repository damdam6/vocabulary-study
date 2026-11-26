// 이번 세션 문제 수 수정 모달 — 홈의 "이번 세션 문제 수" 링크로 연다. 고친 값은 이 브라우저에
// 프로필별로 저장돼 다음 홈 진입에도 시트 설정(sessionLimit)을 대신하고, 시트에는 쓰지 않는다 —
// "기본값으로"를 누르면 시트 값으로 돌아간다. 모달 외형은 등록 검토 모달(register-modal-*)을 재사용한다.
// "순서대로" 스위치도 여기서 켜고 끈다 — 켜면 시트 순서대로 전부 출제하므로 문제 수는 최대로 고정된다.
// 그 아래 "시험모드" 스위치 — 켜면 범위 안 단어를 졸업 단어까지 전부 내므로 문제 수는 범위의 단어 수로
// 고정되고, 기록을 남기지 않으며 끝나면 문제별 결과 화면을 보여 준다. 순서대로와 함께 켤 수 있다.
import { useEffect, useState, type FormEvent } from 'react'

interface SessionLimitModalProps {
  /** 지금 적용 중인 상한(덮어쓴 값 또는 시트 설정) — 입력 초기값. */
  current: number
  /** 시트 설정값 — "기본값으로" 복귀 대상. */
  sheetLimit: number
  /** 지금 범위에서 풀 수 있는 최대 문제 수(복습 대기 + 학습 중). */
  max: number
  /** 지금 "순서대로"가 켜져 있는지 — 스위치 초기값. */
  sequential: boolean
  /** 지금 "시험모드"가 켜져 있는지 — 스위치 초기값. */
  testMode: boolean
  /** 시험모드의 문제 수 — 범위 안 전체 단어 수(졸업 포함). */
  testMax: number
  onCancel: () => void
  /** sequential·testMode 중 하나라도 켜져 있으면 호출부는 문제 수 설정을 덮어쓰지 않는다. */
  onSave: (limit: number, sequential: boolean, testMode: boolean) => void
  onReset: () => void
}

function SessionLimitModal({ current, sheetLimit, max, sequential, testMode, testMax, onCancel, onSave, onReset }: SessionLimitModalProps) {
  const [draft, setDraft] = useState(() => String(Math.min(current, max)))
  const [sequentialDraft, setSequentialDraft] = useState(sequential)
  const [testModeDraft, setTestModeDraft] = useState(testMode)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  // 시험모드면 범위의 전체 단어 수, 순서대로면 최대 문제 수로 고정된다 — 입력한 값은 끄면 그대로 돌아온다.
  const fixed = testModeDraft || sequentialDraft
  const value = testModeDraft ? testMax : sequentialDraft ? max : Number(draft)
  const valid = fixed || (/^\d+$/.test(draft.trim()) && value >= 1 && value <= max)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (valid) onSave(value, sequentialDraft, testModeDraft)
  }

  return (
    <div className="register-modal-backdrop">
      <form
        className="register-modal session-limit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-limit-modal-title"
        onSubmit={handleSubmit}
      >
        <h2 className="register-modal-title" id="session-limit-modal-title">
          이번 세션 문제 수
        </h2>
        <p className="register-modal-hint">
          다음에도 이 값이 유지돼요. 시트 설정 {sheetLimit}문제 · 지금 풀 수 있는 문제 최대 {max}개
        </p>

        <label className="register-modal-field">
          <span className="register-modal-field-label">문제 수 (1–{max})</span>
          <input
            className="register-modal-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            step={1}
            value={fixed ? String(value) : draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={!valid}
            disabled={fixed}
            autoFocus
          />
        </label>
        {!valid && <p className="session-limit-modal-error">1부터 {max} 사이의 숫자를 입력하세요.</p>}

        <div className="session-limit-modal-option">
          <div className="session-limit-modal-option-text">
            <span className="session-limit-modal-option-label" id="session-limit-sequential-label">순서대로</span>
            <span className="session-limit-modal-option-hint">시트 순서대로 출제 · 문제 수 최대</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sequentialDraft}
            aria-labelledby="session-limit-sequential-label"
            className={`toggle-switch${sequentialDraft ? ' toggle-switch--on' : ''}`}
            onClick={() => setSequentialDraft((on) => !on)}
          >
            <span className="toggle-switch-knob" />
          </button>
        </div>

        <div className="session-limit-modal-option">
          <div className="session-limit-modal-option-text">
            <span className="session-limit-modal-option-label" id="session-limit-test-label">시험모드</span>
            <span className="session-limit-modal-option-hint">졸업 포함 모든 단어 · 기록 안 남김 · 끝나면 결과 보기</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={testModeDraft}
            aria-labelledby="session-limit-test-label"
            className={`toggle-switch${testModeDraft ? ' toggle-switch--on' : ''}`}
            onClick={() => setTestModeDraft((on) => !on)}
          >
            <span className="toggle-switch-knob" />
          </button>
        </div>

        <div className="register-modal-actions">
          <button type="button" className="session-limit-modal-reset" onClick={onReset}>
            기본값으로
          </button>
          <button type="button" className="register-modal-cancel" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="register-modal-save" disabled={!valid}>
            저장
          </button>
        </div>
      </form>
    </div>
  )
}

export default SessionLimitModal
