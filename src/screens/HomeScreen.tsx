// 플레이스홀더 — 실제 홈 화면(design-prd §3: 현황 카드·스켈레톤·"오늘 세션 · n문제")은
// #13에서 구현. #15에서는 세션 시작 배선만 추가: 시작 클릭 → 단어 조회 → 큐 구성 →
// onStart(queue). 큐 구성은 홈 책임(PRD §6.1)이라 이 계약은 #13에서도 유지된다.
import { useState } from 'react'
import { fetchWords, type WordEntry } from '../lib/api.ts'
import { buildSessionQueue, type SessionQuestion } from '../lib/sessionQueue.ts'
import { getSeoulToday } from '../lib/wordState.ts'

interface HomeScreenProps {
  onStart: (queue: SessionQuestion<WordEntry>[]) => void
}

type Status = 'idle' | 'loading' | 'empty' | 'error'

function HomeScreen({ onStart }: HomeScreenProps) {
  const [status, setStatus] = useState<Status>('idle')

  const start = async () => {
    setStatus('loading')
    try {
      const words = await fetchWords()
      const queue = buildSessionQueue(words, getSeoulToday())
      if (queue.length === 0) {
        // design-prd §3 확정 UI는 버튼 비활성 + "오늘 할 것 없음" — #13에서 교체
        setStatus('empty')
        return
      }
      onStart(queue)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="screen-placeholder">
      <h1>오늘의 학습</h1>
      {status === 'error' && <p>단어를 불러오지 못했습니다 — 다시 시도해 주세요</p>}
      {status === 'empty' && <p>오늘 할 것 없음</p>}
      <button type="button" onClick={start} disabled={status === 'loading'}>
        {status === 'loading' ? '불러오는 중…' : '학습 시작'}
      </button>
    </div>
  )
}

export default HomeScreen
