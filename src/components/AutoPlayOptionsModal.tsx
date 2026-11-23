// 자동 재생 옵션 — 자동 재생 화면 헤더의 "옵션" 버튼으로 연다. 바꾼 값은 즉시 적용되고
// 이 브라우저에 프로필별로 저장된다. 모달 외형은 등록 검토 모달(register-modal-*)을 재사용한다.
import { useEffect } from 'react'
import { AUTO_PLAY_GAP_MAX_SECONDS, AUTO_PLAY_GAP_MIN_SECONDS } from '../lib/autoPlayPreferences.ts'

interface AutoPlayOptionsModalProps {
  gapSeconds: number
  onGapChange: (seconds: number) => void
  /** 이 세션이 표제어 발음(중국어 TTS)을 낼 수 있는지 — 없으면 중국어 읽기 스위치를 보이지 않는다. */
  headwordSupported: boolean
  speakHeadword: boolean
  onSpeakHeadwordChange: (enabled: boolean) => void
  speakMeaning: boolean
  /** 이 브라우저가 음성 합성을 지원하는지 — 지원하지 않으면 스위치를 잠근다. */
  meaningSupported: boolean
  onSpeakMeaningChange: (enabled: boolean) => void
  onClose: () => void
}

function AutoPlayOptionsModal({
  gapSeconds, onGapChange, headwordSupported, speakHeadword, onSpeakHeadwordChange,
  speakMeaning, meaningSupported, onSpeakMeaningChange, onClose,
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
          <span className="autoplay-option-label">다음 단어까지 대기</span>
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

        {headwordSupported && (
          <div className="autoplay-option">
            <span className="autoplay-option-label" id="autoplay-headword-label">중국어 읽기</span>
            <button
              type="button"
              role="switch"
              aria-checked={speakHeadword}
              aria-labelledby="autoplay-headword-label"
              className={`toggle-switch${speakHeadword ? ' toggle-switch--on' : ''}`}
              onClick={() => onSpeakHeadwordChange(!speakHeadword)}
            >
              <span className="toggle-switch-knob" />
            </button>
          </div>
        )}

        <div className="autoplay-option">
          <span className="autoplay-option-label" id="autoplay-meaning-label">뜻 읽기</span>
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
