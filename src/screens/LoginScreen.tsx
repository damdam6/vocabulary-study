import { useState, type FormEvent } from 'react'
import { savePassword, verifyPassword } from '../lib/api.ts'

// design-prd §2 로그인 화면 — GET /api/health로 검증, 성공 시 localStorage 저장
interface LoginScreenProps {
  onLogin: () => void
}

type Status = 'idle' | 'verifying' | 'invalid' | 'error'

function LoginScreen({ onLogin }: LoginScreenProps) {
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  const hasError = status === 'invalid' || status === 'error'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (status === 'verifying') return
    setStatus('verifying')
    const result = await verifyPassword(password)
    if (result === 'ok') {
      savePassword(password)
      onLogin()
      return
    }
    setStatus(result)
  }

  return (
    <div className="login">
      <div className="login-logo" lang="zh-Hans">
        词
      </div>
      <h1 className="login-title">단어 암기</h1>
      <p className="login-desc">
        구글 시트의 단어로 오늘의 퀴즈를 만듭니다.
        <br />
        비밀번호를 입력하세요.
      </p>
      <form className="login-form" onSubmit={handleSubmit}>
        <input
          className={'login-input' + (hasError ? ' login-input--error' : '')}
          type="password"
          placeholder="비밀번호"
          autoComplete="off"
          autoFocus
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            // 재입력 시작하면 오류 표시 제거 (design-prd §2)
            if (hasError) setStatus('idle')
          }}
        />
        {hasError && (
          <p className="login-error">
            {status === 'invalid' ? '비밀번호가 올바르지 않습니다' : '서버에 연결할 수 없습니다'}
          </p>
        )}
        <button className="login-submit" type="submit" disabled={status === 'verifying'}>
          {status === 'verifying' ? '확인 중…' : '들어가기'}
        </button>
      </form>
    </div>
  )
}

export default LoginScreen
