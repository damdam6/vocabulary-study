// 모드 3 (유의어 고르기). 셸과의 계약은 모드2와 같다:
//   - 보기를 누르는 순간 onJudged(정답 여부)를 한 번 호출한다.
//   - 정답이면 셸이 즉시 다음 문제로 전환한다.
//   - 오답이면 정답·내 선택을 표시한 채 머물고, "다음" 버튼에서 onProceed를 호출해야 셸이 진행한다.
// 보기와 방향(뜻→원문 / 원문→뜻)은 세션 시작 시 attachSynonymChoices가 큐에 고정해 둔다.
import { useEffect, useRef, useState } from 'react'
import { headwordLang } from '../lib/contentLabels.ts'
import type { ContentType } from '../lib/api.ts'
import type { StudyQuestion } from '../lib/studySession.ts'
import type { PronunciationBinding } from '../lib/ttsTypes.ts'
import PronunciationButton from '../components/PronunciationButton.tsx'
import './Mode3Card.css'

interface Mode3CardProps {
  question: StudyQuestion
  contentType: ContentType
  onJudged: (correct: boolean) => void
  onProceed: () => void
  pronunciation?: PronunciationBinding
}

function Mode3Card({ question, contentType, onJudged, onProceed, pronunciation }: Mode3CardProps) {
  // null이 아니면 오답 결과 표시 중 — 값은 사용자가 고른 보기의 원문 키(hanzi)다.
  const [picked, setPicked] = useState<string | null>(null)
  const judgedRef = useRef(false)
  const revealConsumedRef = useRef(false)
  const proceedRef = useRef<HTMLButtonElement>(null)
  const { word } = question
  const choices = question.choices ?? [word]
  const askMeaning = question.prompt !== 'hanzi'
  const lang = headwordLang(contentType)

  useEffect(() => {
    if (picked === null) return
    proceedRef.current?.focus()
    if (pronunciation === undefined || revealConsumedRef.current) return
    const timer = window.setTimeout(() => {
      revealConsumedRef.current = true
      pronunciation.reveal()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [picked, pronunciation])

  const choose = (hanzi: string) => {
    if (judgedRef.current) return
    judgedRef.current = true
    const correct = hanzi === word.hanzi
    if (!correct) setPicked(hanzi)
    onJudged(correct)
  }

  const choiceState = (hanzi: string): string => {
    if (picked === null) return ''
    if (hanzi === word.hanzi) return ' mode3-choice--answer'
    return hanzi === picked ? ' mode3-choice--picked' : ''
  }

  return (
    <div className="mode-area mode-area--m3">
      <div className={`mode-card${picked === null ? '' : ' mode-card--result'}`}>
        {picked !== null && <span className="mode-result-title">오답</span>}
        {picked === null ? (
          askMeaning
            ? <span className="mode-card-meaning mode-card-meaning--question">{word.meaning}</span>
            : <span lang={lang} className="mode-card-hanzi">{word.hanzi}</span>
        ) : (
          <>
            <span lang={lang} className="mode-card-hanzi">{word.hanzi}</span>
            {(word.pinyin || pronunciation) && (
              <div className={`pinyin-speaker${word.pinyin ? '' : ' pinyin-speaker--no-pinyin'}`}>
                {word.pinyin && <span className="mode-card-pinyin">{word.pinyin}</span>}
                {pronunciation && (
                  <div className="pinyin-speaker__button">
                    <PronunciationButton snapshot={pronunciation.snapshot} replay={pronunciation.replay} size="compact" />
                  </div>
                )}
              </div>
            )}
            <span className="mode-card-meaning">{word.meaning}</span>
          </>
        )}
        {picked === null && (
          <span className="mode-card-hint">{askMeaning ? '이 뜻에 맞는 단어를 고르세요' : '이 단어의 뜻을 고르세요'}</span>
        )}
      </div>
      <div className="mode3-choices" role="group" aria-label="보기">
        {choices.map((choice) => (
          <button
            key={choice.hanzi}
            type="button"
            className={`mode3-choice${choiceState(choice.hanzi)}`}
            disabled={picked !== null}
            onClick={() => choose(choice.hanzi)}
          >
            {askMeaning ? <span lang={lang}>{choice.hanzi}</span> : choice.meaning}
          </button>
        ))}
      </div>
      {picked !== null && (
        <button ref={proceedRef} type="button" className="primary-button" onClick={onProceed}>
          다음
        </button>
      )}
    </div>
  )
}

export default Mode3Card
