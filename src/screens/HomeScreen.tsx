// 플레이스홀더 — 실제 홈 화면(design-prd §3)은 #13에서 구현
interface HomeScreenProps {
  onStart: () => void
}

function HomeScreen({ onStart }: HomeScreenProps) {
  return (
    <div className="screen-placeholder">
      <h1>오늘의 학습</h1>
      <button onClick={onStart}>학습 시작</button>
    </div>
  )
}

export default HomeScreen
