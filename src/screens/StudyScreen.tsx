/**
 * 학습 화면 셸 (#15, design-prd §4.1·§4.4·§4.5). 홈이 만든 큐를 받아 문제 단위로
 * 소비하며 기록 API 발사·재삽입·집계·완료 전환을 오케스트레이션한다. 문제 카드
 * UI는 Mode1Card/Mode2Card(#16/#17)에 위임하고, 진행 템포는 여기가 소유한다:
 * 모드1 O/X·모드2 정답은 즉시 다음 문제, 모드2 오답만 결과 화면 후 "다음"으로.
 */
import { useRef, useState } from 'react'
import Mode1Card from './Mode1Card.tsx'
import Mode2Card from './Mode2Card.tsx'
import { postAnswer, postReviewFail, type AnswerRecord, type WordEntry } from '../lib/api.ts'
import { enqueueAnswer, enqueueReviewFail } from '../lib/retryQueue.ts'
import type { SessionQuestion } from '../lib/sessionQueue.ts'
import {
  advance,
  applyWordUpdate,
  currentQuestion,
  isDone,
  recordAnswer,
  startSession,
  type RecordEffect,
  type StudySessionState,
} from '../lib/studySession.ts'
import { formatSeoulDateTime } from '../lib/time.ts'

export interface SessionResult {
  correct: number
  wrong: number
}

interface StudyScreenProps {
  queue: SessionQuestion<WordEntry>[]
  onExit: () => void
  onComplete: (result: SessionResult) => void
}

/** seq는 연속 판정에서도 오버레이 애니메이션이 재시작되도록 key로 쓴다. */
interface Feedback {
  glyph: 'O' | 'X'
  seq: number
}

function StudyScreen({ queue, onExit, onComplete }: StudyScreenProps) {
  const [session, setSession] = useState<StudySessionState>(() => startSession(queue))
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // 마지막 문제의 판정 피드백이 화면 전환으로 유실되지 않도록, 오버레이가 재생 중일
  // 때의 완료 전환만 오버레이 종료(onAnimationEnd) 시점으로 미룬다. 문제 간 전환은
  // 항상 즉시(§4.4 논블로킹).
  const pendingComplete = useRef<SessionResult | null>(null)

  const question = currentQuestion(session)

  // 기록 전송은 문제 단위 비동기 fire-and-forget — 실패가 진행을 막지 않는다(§6.2).
  // 실패분은 재시도 큐(#18, #43)에 적재해 재전송한다 — answer의 timestamp는
  // 최초 판정 시각 유지.
  const fireEffect = (effect: RecordEffect) => {
    if (effect.kind === 'answer') {
      const { word, mode, isReview } = effect.question
      const record: AnswerRecord = {
        tab: word.tab,
        hanzi: word.hanzi,
        mode,
        timestamp: formatSeoulDateTime(new Date()),
        isReview,
      }
      postAnswer(record)
        .then((updated) => setSession((state) => applyWordUpdate(state, updated)))
        .catch(() => enqueueAnswer(record))
    } else if (effect.kind === 'review-fail') {
      const { word } = effect.question
      postReviewFail(word.tab, word.hanzi).catch(() => enqueueReviewFail({ tab: word.tab, hanzi: word.hanzi }))
    }
  }

  const proceed = (from: StudySessionState, overlayPlaying: boolean) => {
    const next = advance(from)
    if (!isDone(next)) {
      setSession(next)
      return
    }
    const result = { correct: next.correct, wrong: next.wrong }
    if (overlayPlaying) {
      pendingComplete.current = result
      setSession(next)
    } else {
      onComplete(result)
    }
  }

  const handleJudged = (correct: boolean) => {
    if (!question) return
    const { state: recorded, effect } = recordAnswer(session, correct)
    fireEffect(effect)
    if (question.mode === 'm2' && !correct) {
      // 모드2 오답: 카드 컴포넌트가 결과 화면을 띄운 채 머문다 — 오버레이 없음(§4.4),
      // 진행은 "다음" 버튼의 handleProceed에서.
      setSession(recorded)
      return
    }
    setFeedback((prev) => ({ glyph: correct ? 'O' : 'X', seq: (prev?.seq ?? 0) + 1 }))
    proceed(recorded, true)
  }

  const handleProceed = () => proceed(session, false)

  const handleFeedbackEnd = () => {
    setFeedback(null)
    if (pendingComplete.current) {
      const result = pendingComplete.current
      pendingComplete.current = null
      onComplete(result)
    }
  }

  return (
    <>
      <div className="study">
        <header className="study-header">
          {/* §4.1: 종료는 확인 다이얼로그 없이 즉시 홈 복귀 — 기록은 문제 단위로 이미 반영됨(§6.2) */}
          <button type="button" className="study-exit" onClick={onExit}>
            종료
          </button>
          <div className="study-progress">
            <span className="study-progress-now">{Math.min(session.pos + 1, session.queue.length)}</span>
            <span className="study-progress-total"> / {session.queue.length}</span>
          </div>
          <div className="study-header-spacer" aria-hidden="true" />
        </header>
        {question && (
          <>
            <div className="study-chips">
              {question.isReview && <span className="study-chip study-chip--review">복습</span>}
              <span className="study-chip">{question.mode === 'm1' ? '한자 → 뜻' : '뜻 → 한자'}</span>
            </div>
            {question.mode === 'm1' ? (
              <Mode1Card key={session.pos} question={question} onJudged={handleJudged} />
            ) : (
              <Mode2Card
                key={session.pos}
                question={question}
                onJudged={handleJudged}
                onProceed={handleProceed}
              />
            )}
          </>
        )}
      </div>
      {feedback && (
        <div
          key={feedback.seq}
          className={`study-feedback study-feedback--${feedback.glyph === 'O' ? 'o' : 'x'}`}
        >
          <span className="study-feedback-glyph" onAnimationEnd={handleFeedbackEnd}>
            {feedback.glyph}
          </span>
        </div>
      )}
    </>
  )
}

export default StudyScreen
