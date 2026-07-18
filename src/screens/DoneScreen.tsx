// 세션 완료 화면 (#15, design-prd §5). 수치는 이번 세션의 모드1·2 합산 —
// X 자가판정도 오답으로 집계된 값이 그대로 온다.
interface DoneScreenProps {
  correct: number
  wrong: number
  onGoHome: () => void
}

function DoneScreen({ correct, wrong, onGoHome }: DoneScreenProps) {
  return (
    <div className="done">
      <div className="done-body">
        <div className="done-check">✓</div>
        <h2 className="done-title">세션 완료</h2>
        <p className="done-note">기록은 문제 단위로 이미 저장되었습니다</p>
        <div className="done-stats">
          <div className="done-stat">
            <span className="done-stat-num done-stat-num--correct">{correct}</span>
            <span className="done-stat-label">정답</span>
          </div>
          <div className="done-divider" aria-hidden="true" />
          <div className="done-stat">
            <span className="done-stat-num done-stat-num--wrong">{wrong}</span>
            <span className="done-stat-label">오답</span>
          </div>
        </div>
      </div>
      <button type="button" className="done-home" onClick={onGoHome}>
        홈으로
      </button>
    </div>
  )
}

export default DoneScreen
