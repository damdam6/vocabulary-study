// 모드 2 (뜻 → 한자 입력 자동채점, design-prd §4.3 · #17). 셸(#15)과의 계약:
//   - 제출 순간 onJudged(정답 여부)를 한 번 호출한다. 채점은 gradeMode2(PRD §5.2).
//   - 정답이면 셸이 즉시 다음 문제로 전환한다(§4.5) — 결과 화면 없음.
//   - 오답이면 이 컴포넌트가 결과 화면(정답 한자·병음·뜻·내 답)을 띄운 채 머물고,
//     "다음" 버튼에서 onProceed를 호출해야 셸이 진행한다.
//   - 셸이 문제마다 key를 바꿔 리마운트하므로 내부 상태는 초기화를 신경 쓰지 않는다.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
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
  // null이 아니면 오답 결과 화면 표시 중 — 값은 트림된 내 답(빈 입력 오답이면 '')
  const [wrongAnswer, setWrongAnswer] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pronunciationRef = useRef<HTMLDivElement>(null)
  const proceedRef = useRef<HTMLButtonElement>(null)
  const shouldMoveFocusRef = useRef(false)
  const revealConsumedRef = useRef(false)
  const { word } = question
  const lang = headwordLang(contentType)

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
    if (activeElement !== document.body && activeElement !== null && activeElement !== inputRef.current) return
    const pronunciationButton = pronunciationRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    const focusTarget = pronunciationButton ?? proceedRef.current
    focusTarget?.focus()
  }, [wrongAnswer])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (wrongAnswer !== null) return
    const { correct, answer } = gradeMode2(value, word.hanzi)
    if (correct) {
      onJudged(true)
    } else {
      shouldMoveFocusRef.current = document.activeElement === inputRef.current
      setWrongAnswer(answer)
      onJudged(false)
    }
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
            {wrongAnswer !== '' && (
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
        <span className="mode-card-meaning mode-card-meaning--question">{word.meaning}</span>
        <span className="mode-card-hint">{mode2Hint(contentType)}</span>
      </div>
      <input
        ref={inputRef}
        className="mode-input"
        type="text"
        lang={lang}
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
      <button type="submit" className="primary-button">
        제출
      </button>
    </form>
  )
}

export default Mode2Card
