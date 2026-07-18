// 플레이스홀더 — 실제 모드1 카드 UI(design-prd §4.2: 3D 플립·한자 크기 스케일·원형
// O/X 버튼)는 #16에서 교체. 셸(#15)과의 계약은 유지할 것:
//   - 판정 순간(O/X 탭) onJudged(정답 여부)를 한 번 호출한다. O=정답, X=오답.
//   - 진행(다음 문제 전환·피드백 오버레이)은 셸 몫 — 이 컴포넌트는 대기 없이 끝난다.
//   - 셸이 문제마다 key를 바꿔 리마운트하므로 내부 상태는 초기화를 신경 쓰지 않는다.
import { useState } from 'react'
import type { StudyQuestion } from '../lib/studySession.ts'

interface Mode1CardProps {
  question: StudyQuestion
  onJudged: (correct: boolean) => void
}

function Mode1Card({ question, onJudged }: Mode1CardProps) {
  const [revealed, setRevealed] = useState(false)
  const { word } = question

  return (
    <div className="mode-area">
      <button type="button" className="mode-card" onClick={() => setRevealed(true)} disabled={revealed}>
        <span lang="zh-Hans" className="mode-card-hanzi">{word.hanzi}</span>
        {revealed ? (
          <>
            <span className="mode-card-pinyin">{word.pinyin}</span>
            <span className="mode-card-meaning">{word.meaning}</span>
          </>
        ) : (
          <span className="mode-card-hint">탭해서 뜻 보기</span>
        )}
      </button>
      <div className="mode-actions">
        {revealed ? (
          <>
            <button type="button" className="judge judge--x" onClick={() => onJudged(false)}>
              X 몰랐음
            </button>
            <button type="button" className="judge judge--o" onClick={() => onJudged(true)}>
              O 알고 있었음
            </button>
          </>
        ) : (
          <p className="mode-footnote">카드를 탭하면 뜻이 보입니다</p>
        )}
      </div>
    </div>
  )
}

export default Mode1Card
