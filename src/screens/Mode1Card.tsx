// 모드1 카드 (#16, #146): 앞면 공개 버튼과 뒷면 내용 영역을 분리한 3D 플립.
// 판정은 공개 직후 가능하지만, 뒷면은 transform 완료(viewReady) 뒤 접근성 트리에 공개한다.
import { useCallback, useEffect, useRef, useState, type TransitionEvent } from 'react'
import { headwordLang } from '../lib/contentLabels.ts'
import { hanziFontSize } from '../lib/hanziSize.ts'
import type { ContentType } from '../lib/api.ts'
import type { StudyQuestion } from '../lib/studySession.ts'
import type { PronunciationBinding } from '../lib/ttsTypes.ts'
import PronunciationButton from '../components/PronunciationButton.tsx'

interface Mode1CardProps {
  question: StudyQuestion
  contentType: ContentType
  onJudged: (correct: boolean) => void
  /** #145에서 전달한 선택적 binding을 모드1 공개 사건에 연결한다. */
  pronunciation?: PronunciationBinding
}

const TRANSITION_FALLBACK_BUFFER_MS = 100

function transitionTimeMs(value: string): number {
  const trimmed = value.trim()
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed) || 0
  if (trimmed.endsWith('s')) return (Number.parseFloat(trimmed) || 0) * 1000
  return 0
}

function transformTransitionMs(style: CSSStyleDeclaration): number {
  const properties = style.transitionProperty.split(',').map((value) => value.trim())
  const durations = style.transitionDuration.split(',').map(transitionTimeMs)
  const delays = style.transitionDelay.split(',').map(transitionTimeMs)

  return properties.reduce((maximum, property, index) => {
    if (property !== 'transform' && property !== 'all') return maximum
    const duration = durations[index % durations.length] ?? 0
    const delay = delays[index % delays.length] ?? 0
    return Math.max(maximum, duration + delay, 0)
  }, 0)
}

function Mode1Card({ question, contentType, onJudged, pronunciation }: Mode1CardProps) {
  const [revealed, setRevealed] = useState(false)
  const [viewReady, setViewReady] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const revealButtonRef = useRef<HTMLButtonElement>(null)
  const firstJudgeRef = useRef<HTMLButtonElement>(null)
  const completionClosedRef = useRef(false)
  const judgedRef = useRef(false)
  const shouldMoveFocusRef = useRef(false)
  const revealDeliveredRef = useRef(false)
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { word } = question
  const lang = headwordLang(contentType)
  const pronunciationBinding = contentType === 'zh' ? pronunciation : undefined
  // 글자 수 적응 스케일은 zh 전용(이슈 #80) — generic은 고정 클래스로 표시.
  const frontSizeClass = contentType === 'zh' ? `flip-hanzi--${hanziFontSize(word.hanzi)}` : 'flip-hanzi--generic'
  const backSizeClass = contentType === 'zh' ? `mode-card-hanzi--${hanziFontSize(word.hanzi)}` : ''

  const clearFallback = useCallback(() => {
    if (fallbackRef.current !== null) {
      clearTimeout(fallbackRef.current)
      fallbackRef.current = null
    }
  }, [])

  const completeView = useCallback(() => {
    if (completionClosedRef.current) return
    completionClosedRef.current = true
    clearFallback()
    setViewReady(true)
  }, [clearFallback])

  useEffect(() => {
    if (!revealed) return
    const card = cardRef.current
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const transitionMs = card ? transformTransitionMs(window.getComputedStyle(card)) : 0
    if (reducedMotion || transitionMs <= 0) {
      completeView()
      return
    }
    fallbackRef.current = setTimeout(completeView, transitionMs + TRANSITION_FALLBACK_BUFFER_MS)
    return clearFallback
  }, [clearFallback, completeView, revealed])

  useEffect(() => {
    if (!viewReady) return

    if (!revealDeliveredRef.current && pronunciationBinding) {
      revealDeliveredRef.current = true
      pronunciationBinding.reveal()
    }

    if (shouldMoveFocusRef.current && document.activeElement === revealButtonRef.current) {
      const pronunciationButton = cardRef.current?.querySelector<HTMLButtonElement>(
        '.pronunciation-button__control',
      )
      const pronunciationUsable = pronunciationButton && !pronunciationButton.disabled
      if (pronunciationUsable) pronunciationButton.focus()
      else firstJudgeRef.current?.focus()
    }
    shouldMoveFocusRef.current = false
  }, [pronunciationBinding, viewReady])

  useEffect(() => {
    // StrictMode의 개발 수명은 setup → cleanup → setup을 한 번 더 수행한다.
    // 첫 cleanup이 닫은 completion gate를 다음 실제 카드 수명에서 다시 열어야
    // transition 완료·fallback 공개를 놓치지 않는다. 판정/실제 unmount cleanup은
    // 여전히 gate를 닫으므로 늦은 완료는 기존처럼 차단된다.
    completionClosedRef.current = false
    return () => {
      completionClosedRef.current = true
      clearFallback()
    }
  }, [clearFallback])

  const reveal = () => {
    if (revealed) return
    pronunciationBinding?.prepare()
    shouldMoveFocusRef.current = document.activeElement === revealButtonRef.current
    setRevealed(true)
  }

  const judge = (correct: boolean) => {
    if (judgedRef.current) return
    judgedRef.current = true
    completionClosedRef.current = true
    clearFallback()
    onJudged(correct)
  }

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === 'transform') completeView()
  }

  return (
    <div className="mode-area">
      <div className="flip-stage">
        <div
          ref={cardRef}
          className={`flip-card${revealed ? ' flip-card--revealed' : ''}`}
          onTransitionEnd={handleTransitionEnd}
        >
          <div className="flip-face flip-face--front" aria-hidden={revealed} inert={revealed}>
            <span
              lang={lang}
              className={`flip-hanzi ${frontSizeClass}`}
              role="region"
              aria-label={contentType === 'zh' ? '문제 중국어' : '문제 단어'}
              tabIndex={0}
            >
              {word.hanzi}
            </span>
            <button
              ref={revealButtonRef}
              type="button"
              className="flip-reveal-button"
              onClick={reveal}
              disabled={revealed}
            >
              탭해서 뜻 보기
            </button>
          </div>
          <div className="flip-face flip-face--back" aria-hidden={!viewReady} inert={!viewReady}>
            <div className="flip-face-back-content">
              <span lang={lang} className={`mode-card-hanzi${backSizeClass ? ` ${backSizeClass}` : ''}`}>{word.hanzi}</span>
              <div className={`mode-card-pinyin-area pinyin-speaker${word.pinyin ? '' : ' pinyin-speaker--no-pinyin'}`}>
                {word.pinyin && <span className="mode-card-pinyin">{word.pinyin}</span>}
                {viewReady && pronunciationBinding && (
                  <div className="pinyin-speaker__button">
                    <PronunciationButton
                      snapshot={pronunciationBinding.snapshot}
                      replay={pronunciationBinding.replay}
                      size="compact"
                    />
                  </div>
                )}
              </div>
              <span className="mode-card-meaning">{word.meaning}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="judge-zone">
        {revealed ? (
          <div className="judge-row">
            <div className="judge-group">
              <button ref={firstJudgeRef} type="button" className="judge judge--x" onClick={() => judge(false)}>
                X
              </button>
              <span className="judge-label">몰랐음</span>
            </div>
            <div className="judge-group">
              <button type="button" className="judge judge--o" onClick={() => judge(true)}>
                O
              </button>
              <span className="judge-label">알고 있었음</span>
            </div>
          </div>
        ) : (
          <p className="mode-footnote">“탭해서 뜻 보기” 버튼을 누르면 뜻이 보입니다</p>
        )}
      </div>
    </div>
  )
}

export default Mode1Card
