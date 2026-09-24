// 모드 2 (뜻 → 한자 입력 자동채점, design-prd §4.3 · #17). 셸(#15)과의 계약:
//   - 제출 순간 onJudged(정답 여부)를 한 번 호출한다. 채점은 gradeMode2(PRD §5.2).
//   - 정답이면 셸이 즉시 다음 문제로 전환한다(§4.5) — 결과 화면 없음.
//   - 오답이면 이 컴포넌트가 결과 화면(정답 한자·병음·뜻·내 답)을 띄운 채 머물고,
//     "다음" 버튼에서 onProceed를 호출해야 셸이 진행한다.
//   - 셸이 문제마다 key를 바꿔 리마운트하므로 값·높이·scroll·focus는 새 입력 기준으로 초기화한다.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { headwordLang, mode2Hint, mode2Placeholder } from '../lib/contentLabels.ts'
import { gradeMode2, type StudyQuestion } from '../lib/studySession.ts'
import type { ContentType } from '../lib/api.ts'
import type { PronunciationBinding } from '../lib/ttsTypes.ts'
import PronunciationButton from '../components/PronunciationButton.tsx'
import './Mode2Card.css'

interface Mode2CardProps {
  question: StudyQuestion
  contentType: ContentType
  onJudged: (correct: boolean) => void
  onProceed: () => void
  /** #145에서 선언·전달만 한다. 결과 공개와 재생 UI는 #148이 소유한다. */
  pronunciation?: PronunciationBinding
}

function Mode2Card({ question, contentType, onJudged, onProceed, pronunciation }: Mode2CardProps) {
  const [value, setValue] = useState('')
  // null이 아니면 오답 결과 화면 표시 중 — 값은 사용자가 제출한 원문이다.
  const [wrongAnswer, setWrongAnswer] = useState<string | null>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pronunciationRef = useRef<HTMLDivElement>(null)
  const proceedRef = useRef<HTMLButtonElement>(null)
  const shouldMoveFocusRef = useRef(false)
  const revealConsumedRef = useRef(false)
  const { word } = question
  const lang = headwordLang(contentType)
  const isChinese = contentType === 'zh'

  useLayoutEffect(() => {
    const input = textareaRef.current
    if (input === null) return
    input.style.height = '60px'
    const nextHeight = Math.max(60, Math.min(input.scrollHeight, 144))
    input.style.height = `${nextHeight}px`
    input.style.overflowY = input.scrollHeight > 144 ? 'auto' : 'hidden'
    if (value === '') input.scrollTop = 0
  }, [value])

  useEffect(() => {
    if (wrongAnswer === null || pronunciation === undefined || revealConsumedRef.current) return
    const timer = window.setTimeout(() => {
      revealConsumedRef.current = true
      pronunciation.reveal()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pronunciation, wrongAnswer])

  useLayoutEffect(() => {
    if (wrongAnswer === null || !shouldMoveFocusRef.current) return
    shouldMoveFocusRef.current = false
    const activeElement = document.activeElement
    const input = isChinese ? textareaRef.current : textInputRef.current
    if (activeElement !== document.body && activeElement !== null && activeElement !== input) return
    const pronunciationButton = pronunciationRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    const focusTarget = pronunciationButton ?? proceedRef.current
    focusTarget?.focus()
  }, [isChinese, wrongAnswer])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (wrongAnswer !== null) return
    const { correct, answer } = gradeMode2(value, word.hanzi, contentType)
    if (correct) {
      onJudged(true)
    } else {
      const input = isChinese ? textareaRef.current : textInputRef.current
      shouldMoveFocusRef.current = document.activeElement === input
      setWrongAnswer(answer)
      onJudged(false)
    }
  }

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    const nativeEvent = event.nativeEvent
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  if (wrongAnswer !== null) {
    return (
      <div className="mode-area mode-area--m2">
        <div className="mode-card mode-card--result">
          <span className="mode-result-title">오답</span>
          <div className="mode2-result-scroll">
            <span lang={lang} className="mode-card-hanzi">{word.hanzi}</span>
            {(word.pinyin || pronunciation) && (
              <div className={`pinyin-speaker${word.pinyin ? '' : ' pinyin-speaker--no-pinyin'}`}>
                {word.pinyin && <span className="mode-card-pinyin">{word.pinyin}</span>}
                {pronunciation && (
                  <div className="pinyin-speaker__button" ref={pronunciationRef}>
                    <PronunciationButton
                      snapshot={pronunciation.snapshot}
                      replay={pronunciation.replay}
                      size="compact"
                    />
                  </div>
                )}
              </div>
            )}
            <span className="mode-card-meaning">{word.meaning}</span>
            {wrongAnswer.trim() !== '' && (
              <span className="mode-my-answer">
                내 답: <s lang={lang}>{wrongAnswer}</s>
              </span>
            )}
          </div>
        </div>
        <button ref={proceedRef} type="button" className="primary-button" onClick={onProceed}>
          다음
        </button>
      </div>
    )
  }

  return (
    <form className="mode-area mode-area--m2" onSubmit={submit}>
      <div className="mode-card">
        <div className="mode2-question-scroll">
          <span className="mode-card-meaning mode-card-meaning--question">{word.meaning}</span>
        </div>
        <span className="mode-card-hint">{mode2Hint(contentType)}</span>
      </div>
      {isChinese ? (
        <textarea
          ref={textareaRef}
          className="mode-input mode-input--textarea"
          lang={lang}
          rows={1}
          aria-label={mode2Hint(contentType)}
          placeholder={mode2Placeholder(contentType)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleTextareaKeyDown}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
        />
      ) : (
        <input
          ref={textInputRef}
          className="mode-input"
          type="text"
          lang={lang}
          aria-label={mode2Hint(contentType)}
          placeholder={mode2Placeholder(contentType)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
        />
      )}
      <button type="submit" className="primary-button">
        제출
      </button>
    </form>
  )
}

export default Mode2Card
