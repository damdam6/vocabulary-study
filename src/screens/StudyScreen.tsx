// 플레이스홀더 — 실제 학습 화면(design-prd §4)은 #15(셸)·#16·#17(모드 UI)에서 구현
interface StudyScreenProps {
  onExit: () => void
  onComplete: () => void
}

function StudyScreen({ onExit, onComplete }: StudyScreenProps) {
  return (
    <div className="screen-placeholder">
      <h1>학습</h1>
      {/* 한자 폰트(Noto Sans SC) 적용 확인용 샘플 */}
      <span lang="zh-Hans" style={{ fontSize: 52 }}>
        经济
      </span>
      <button onClick={onExit}>종료</button>
      <button onClick={onComplete}>세션 완료</button>
    </div>
  )
}

export default StudyScreen
