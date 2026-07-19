// 모드 2 (뜻 → 한자 입력 자동채점, design-prd §4.3 · #17). 셸(#15)과의 계약:
//   - 제출 순간 onJudged(정답 여부)를 한 번 호출한다. 채점은 gradeMode2(PRD §5.2).
//   - 정답이면 셸이 즉시 다음 문제로 전환한다(§4.5) — 결과 화면 없음.
//   - 오답이면 이 컴포넌트가 결과 화면(정답 한자·병음·뜻·내 답)을 띄운 채 머물고,
//     "다음" 버튼에서 onProceed를 호출해야 셸이 진행한다.
//   - 셸이 문제마다 key를 바꿔 리마운트하므로 내부 상태는 초기화를 신경 쓰지 않는다.
import { useState, type FormEvent } from 'react'
import { gradeMode2, type StudyQuestion } from '../lib/studySession.ts'

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
    const { correct, answer } = gradeMode2(value, word.hanzi)
    if (correct) {
      onJudged(true)
    } else {
      setWrongAnswer(answer)
      onJudged(false)
    }
  }

  if (wrongAnswer !== null) {
    return (
      <div className="mode-area mode-area--m2">
        <div className="mode-card mode-card--result">
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
    <form className="mode-area mode-area--m2" onSubmit={submit}>
      <div className="mode-card">
        <span className="mode-card-meaning mode-card-meaning--question">{word.meaning}</span>
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
