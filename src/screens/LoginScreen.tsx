// 플레이스홀더 — 실제 로그인 화면(design-prd §2)은 #11에서 구현
interface LoginScreenProps {
  onLogin: () => void
}

function LoginScreen({ onLogin }: LoginScreenProps) {
  return (
    <div className="screen-placeholder">
      <h1>로그인</h1>
      <button type="button" onClick={onLogin}>들어가기</button>
    </div>
  )
}

export default LoginScreen
