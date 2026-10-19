// 이번 세션 문제 수 수정 모달 — 홈의 "이번 세션 문제 수" 링크로 연다. 고친 값은 이번
// 홈 진입 동안만 시트 설정(sessionLimit)을 대신하고 시트에는 쓰지 않는다 — 홈을 다시
// 들어오면 시트 값으로 돌아간다. 모달 외형은 등록 검토 모달(register-modal-*)을 재사용한다.
import { useEffect, useState, type FormEvent } from 'react'

interface SessionLimitModalProps {
  /** 지금 적용 중인 상한(덮어쓴 값 또는 시트 설정) — 입력 초기값. */
  current: number
  /** 시트 설정값 — "기본값으로" 복귀 대상. */
  sheetLimit: number
  /** 지금 범위에서 풀 수 있는 최대 문제 수(복습 대기 + 학습 중). */
  max: number
  onCancel: () => void
  onSave: (limit: number) => void
  onReset: () => void
}

function SessionLimitModal({ current, sheetLimit, max, onCancel, onSave, onReset }: SessionLimitModalProps) {
  const [draft, setDraft] = useState(() => String(Math.min(current, max)))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const value = Number(draft)
  const valid = /^\d+$/.test(draft.trim()) && value >= 1 && value <= max

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (valid) onSave(value)
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
          이번 학습에만 적용돼요. 시트 설정 {sheetLimit}문제 · 지금 풀 수 있는 문제 최대 {max}개
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
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={!valid}
            autoFocus
          />
        </label>
        {!valid && <p className="session-limit-modal-error">1부터 {max} 사이의 숫자를 입력하세요.</p>}

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
