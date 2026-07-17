import { useState } from 'react'
import LoginScreen from './screens/LoginScreen.tsx'
import HomeScreen from './screens/HomeScreen.tsx'
import StudyScreen from './screens/StudyScreen.tsx'
import DoneScreen from './screens/DoneScreen.tsx'

type Screen = 'login' | 'home' | 'study' | 'done'

function App() {
  const [screen, setScreen] = useState<Screen>('login')

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
