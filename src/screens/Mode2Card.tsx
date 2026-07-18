// 플레이스홀더 — 실제 모드2 UI(design-prd §4.3: 결과 연출·shake 등)는 #17에서 교체.
// 셸(#15)과의 계약은 유지할 것:
//   - 제출 순간 onJudged(정답 여부)를 한 번 호출한다. 채점은 이 컴포넌트 책임 —
//     트림 후 A열 한자와 정확 일치, 빈 입력=오답 (PRD §5.2).
//   - 정답이면 셸이 즉시 다음 문제로 전환한다(§4.5) — 결과 화면 없음.
//   - 오답이면 이 컴포넌트가 결과 화면(정답 한자·병음·뜻·내 답)을 띄운 채 머물고,
//     "다음" 버튼에서 onProceed를 호출해야 셸이 진행한다.
//   - 셸이 문제마다 key를 바꿔 리마운트하므로 내부 상태는 초기화를 신경 쓰지 않는다.
import { useState, type FormEvent } from 'react'
import type { StudyQuestion } from '../lib/studySession.ts'

interface Mode2CardProps {
  question: StudyQuestion
  onJudged: (correct: boolean) => void
  onProceed: () => void
}

function Mode2Card({ question, onJudged, onProceed }: Mode2CardProps) {
  const [value, setValue] = useState('')
  // null이 아니면 오답 결과 화면 표시 중 — 값은 트림된 내 답(빈 입력 오답이면 '')
  const [wrongAnswer, setWrongAnswer] = useState<string | null>(null)
  const { word } = question

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (wrongAnswer !== null) return
    const answer = value.trim()
    if (answer === word.hanzi) {
      onJudged(true)
    } else {
      setWrongAnswer(answer)
      onJudged(false)
    }
  }

  if (wrongAnswer !== null) {
    return (
      <div className="mode-area">
        <div className="mode-card">
          <span className="mode-result-title">오답</span>
          <span lang="zh-Hans" className="mode-card-hanzi">{word.hanzi}</span>
          <span className="mode-card-pinyin">{word.pinyin}</span>
          <span className="mode-card-meaning">{word.meaning}</span>
          {wrongAnswer !== '' && (
            <span className="mode-my-answer">
              내 답: <s lang="zh-Hans">{wrongAnswer}</s>
            </span>
          )}
        </div>
        <button type="button" className="primary-button" onClick={onProceed}>
          다음
        </button>
      </div>
    )
  }

  return (
    <form className="mode-area" onSubmit={submit}>
      <div className="mode-card">
        <span className="mode-card-meaning">{word.meaning}</span>
        <span className="mode-card-hint">이 뜻의 한자를 입력하세요</span>
      </div>
      <input
        className="mode-input"
        type="text"
        lang="zh-Hans"
        placeholder="汉字"
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
