import { useEffect, useState } from 'react'
import LoginScreen from './screens/LoginScreen.tsx'
import HomeScreen from './screens/HomeScreen.tsx'
import StudyScreen from './screens/StudyScreen.tsx'
import DoneScreen from './screens/DoneScreen.tsx'
import { getStoredPassword, setUnauthorizedHandler } from './lib/api.ts'

type Screen = 'login' | 'home' | 'study' | 'done'

function App() {
  // 새로고침 시 저장된 비밀번호가 있으면 재입력 없이 통과 (PRD §8)
  const [screen, setScreen] = useState<Screen>(() => (getStoredPassword() ? 'home' : 'login'))

  // 어느 API든 401 수신 시 로그인 화면 복귀 — 저장값 삭제는 apiFetch가 이미 수행
  useEffect(() => {
    setUnauthorizedHandler(() => setScreen('login'))
    return () => setUnauthorizedHandler(null)
  }, [])

  return (
    <div className="app-frame">
      <div className="app-column">
        {screen === 'login' && <LoginScreen onLogin={() => setScreen('home')} />}
        {screen === 'home' && <HomeScreen onStart={() => setScreen('study')} />}
        {screen === 'study' && (
          <StudyScreen onExit={() => setScreen('home')} onComplete={() => setScreen('done')} />
        )}
        {screen === 'done' && <DoneScreen onGoHome={() => setScreen('home')} />}
      </div>
    </div>
  )
}

export default App
