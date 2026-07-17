// 플레이스홀더 — 실제 세션 완료 화면(design-prd §5)은 #15에서 구현
interface DoneScreenProps {
  onGoHome: () => void
}

function DoneScreen({ onGoHome }: DoneScreenProps) {
  return (
    <div className="screen-placeholder">
      <h1>세션 완료</h1>
      <button onClick={onGoHome}>홈으로</button>
    </div>
  )
}

export default DoneScreen
