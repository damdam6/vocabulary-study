import { useEffect, useState } from 'react'
import LoginScreen from './screens/LoginScreen.tsx'
import HomeScreen from './screens/HomeScreen.tsx'
import StudyScreen, { type SessionResult } from './screens/StudyScreen.tsx'
import DoneScreen from './screens/DoneScreen.tsx'
import { getStoredPassword, setApiSuccessHandler, setUnauthorizedHandler, type WordEntry } from './lib/api.ts'
import { flushRetryQueue } from './lib/retryQueue.ts'
import type { SessionQuestion } from './lib/sessionQueue.ts'

type Screen = 'login' | 'home' | 'study' | 'done'

function App() {
  // 새로고침 시 저장된 비밀번호가 있으면 재입력 없이 통과 (PRD §8)
  const [screen, setScreen] = useState<Screen>(() => (getStoredPassword() ? 'home' : 'login'))
  // 세션 큐는 홈이 만들고(PRD §6.1) 셸이 소비한다(§6.2) — App은 화면 간 전달만 담당
  const [sessionQueue, setSessionQueue] = useState<SessionQuestion<WordEntry>[]>([])
  const [sessionResult, setSessionResult] = useState<SessionResult>({ correct: 0, wrong: 0 })

  // 어느 API든 401 수신 시 로그인 화면 복귀 — 저장값 삭제는 apiFetch가 이미 수행
  useEffect(() => {
    setUnauthorizedHandler(() => setScreen('login'))
    return () => setUnauthorizedHandler(null)
  }, [])

  // 재시도 큐 재전송(PRD §10, #18): 앱 로드 시 1회 + 이후 어느 API든 성공 시점.
  // flush 자체의 성공이 핸들러를 재호출해도 flushRetryQueue의 재진입 가드가 막는다.
  useEffect(() => {
    setApiSuccessHandler(() => void flushRetryQueue())
    void flushRetryQueue()
    return () => setApiSuccessHandler(null)
  }, [])

  const startSession = (queue: SessionQuestion<WordEntry>[]) => {
    setSessionQueue(queue)
    setScreen('study')
  }

  const completeSession = (result: SessionResult) => {
    setSessionResult(result)
    setScreen('done')
  }

  return (
    <div className="app-frame">
      <div className="app-column">
        {screen === 'login' && <LoginScreen onLogin={() => setScreen('home')} />}
        {screen === 'home' && <HomeScreen onStart={startSession} />}
        {screen === 'study' && (
          <StudyScreen queue={sessionQueue} onExit={() => setScreen('home')} onComplete={completeSession} />
        )}
        {screen === 'done' && (
          <DoneScreen
            correct={sessionResult.correct}
            wrong={sessionResult.wrong}
            onGoHome={() => setScreen('home')}
          />
        )}
      </div>
    </div>
  )
}

export default App
