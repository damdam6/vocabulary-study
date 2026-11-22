// 자동 재생 옵션 — 자동 재생 화면 헤더의 "옵션" 버튼으로 연다. 바꾼 값은 즉시 적용되고
// 이 브라우저에 프로필별로 저장된다. 모달 외형은 등록 검토 모달(register-modal-*)을 재사용한다.
import { useEffect } from 'react'
import { AUTO_PLAY_GAP_MAX_SECONDS, AUTO_PLAY_GAP_MIN_SECONDS } from '../lib/autoPlayPreferences.ts'

interface AutoPlayOptionsModalProps {
  gapSeconds: number
  onGapChange: (seconds: number) => void
  speakMeaning: boolean
  /** 이 브라우저가 음성 합성을 지원하는지 — 지원하지 않으면 스위치를 잠근다. */
  meaningSupported: boolean
  onSpeakMeaningChange: (enabled: boolean) => void
  onClose: () => void
}

function AutoPlayOptionsModal({
  gapSeconds, onGapChange, speakMeaning, meaningSupported, onSpeakMeaningChange, onClose,
}: AutoPlayOptionsModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="register-modal-backdrop">
      <div
        className="register-modal autoplay-options-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="autoplay-options-title"
      >
        <h2 className="register-modal-title" id="autoplay-options-title">
          자동 재생 옵션
        </h2>

        <div className="autoplay-option">
          <div className="autoplay-option-text">
            <span className="autoplay-option-label">다음 단어까지 대기</span>
            <span className="autoplay-option-hint">발음이 끝난 뒤 · {AUTO_PLAY_GAP_MIN_SECONDS}–{AUTO_PLAY_GAP_MAX_SECONDS}초</span>
          </div>
          <div className="autoplay-stepper" role="group" aria-label="대기 시간">
            <button
              type="button"
              className="autoplay-stepper-button"
              aria-label="대기 시간 줄이기"
              disabled={gapSeconds <= AUTO_PLAY_GAP_MIN_SECONDS}
              onClick={() => onGapChange(gapSeconds - 1)}
            >
              −
            </button>
            <span className="autoplay-stepper-value" aria-live="polite">{gapSeconds}초</span>
            <button
              type="button"
              className="autoplay-stepper-button"
              aria-label="대기 시간 늘리기"
              disabled={gapSeconds >= AUTO_PLAY_GAP_MAX_SECONDS}
              onClick={() => onGapChange(gapSeconds + 1)}
            >
              +
            </button>
          </div>
        </div>

        <div className="autoplay-option">
          <div className="autoplay-option-text">
            <span className="autoplay-option-label" id="autoplay-meaning-label">뜻 읽어주기</span>
            <span className="autoplay-option-hint">
              {meaningSupported
                ? '발음 뒤에 뜻을 한국어로 · 기기 음성 사용'
                : '이 브라우저는 음성 읽기를 지원하지 않아요'}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={speakMeaning && meaningSupported}
            aria-labelledby="autoplay-meaning-label"
            className={`toggle-switch${speakMeaning && meaningSupported ? ' toggle-switch--on' : ''}`}
            disabled={!meaningSupported}
            onClick={() => onSpeakMeaningChange(!speakMeaning)}
          >
            <span className="toggle-switch-knob" />
          </button>
        </div>

        <div className="register-modal-actions">
          <button type="button" className="register-modal-save" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default AutoPlayOptionsModal
