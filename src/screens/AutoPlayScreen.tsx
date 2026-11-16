// 자동 재생 화면 — 문제 풀이 없이 오늘 학습 큐의 단어를 차례로 보여 주며 발음을 들려준다.
//   - 표제어·병음·뜻을 한 번에 보여 주고, 발음이 끝나면 잠깐 쉬었다가 다음 단어로 넘어간다.
//   - 발음이 없는 단어(TTS 미지원 프로필·TTS off·재생 불가 표제어)는 고정 시간만 보여 주고 넘어간다.
//   - 학습 기록(/api/answer, /api/review-fail)은 일절 보내지 않는다 — 순수 듣기·보기 전용.
//   - 홈의 발음 자동재생 설정과 무관하게 소리를 낸다 — 이 화면은 재생 자체가 목적이다.
import { useEffect, useRef, useState } from 'react'
import { headwordLang, supportsPronunciation } from '../lib/contentLabels.ts'
import { usePronunciation } from '../hooks/usePronunciation.ts'
import type { PublicProfile, WordEntry } from '../lib/api.ts'
import type { TtsCapability } from '../lib/ttsTypes.ts'
import PronunciationButton from '../components/PronunciationButton.tsx'
import './Mode2Card.css'

/** 발음이 끝난 뒤 다음 단어로 넘어가기 전 쉬는 시간. */
export const AUTO_PLAY_GAP_MS = 1500
/** 발음이 없는 단어를 보여 주는 시간. */
export const AUTO_PLAY_SILENT_MS = 3000
/** 발음 로드·재생에 실패한 단어를 보여 주는 시간. */
export const AUTO_PLAY_ERROR_MS = 2500
/** 발음 상태가 끝내 진행되지 않을 때 다음으로 넘기는 안전장치. */
export const AUTO_PLAY_STALL_MS = 20000

interface AutoPlayScreenProps {
  words: WordEntry[]
  profile: PublicProfile
  tts: TtsCapability
  onExit: () => void
}

let autoPlaySequence = 0

function createAutoPlayId(): string {
  const generated = globalThis.crypto?.randomUUID?.()
  return generated ?? `autoplay-${++autoPlaySequence}`
}

function AutoPlayScreen({ words, profile, tts, onExit }: AutoPlayScreenProps) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [done, setDone] = useState(words.length === 0)
  // 일시정지 후 재개는 같은 단어를 새 질문으로 다시 활성화해 처음부터 재생한다.
  const [epoch, setEpoch] = useState(0)
  const [sessionId] = useState(createAutoPlayId)
  const revealedRef = useRef<string | null>(null)
  const playedRef = useRef<string | null>(null)

  const word = done ? null : words[index]
  const questionId = word === null || paused ? null : `${sessionId}:${index}:${epoch}`
  const { pronunciation, stop } = usePronunciation({
    profileId: profile.id,
    contentType: profile.contentType,
    capability: tts,
    autoPlay: true,
    questionId,
    input: word === null ? null : { text: word.hanzi, pinyin: word.pinyin || null },
  })
  const audioSupported = supportsPronunciation(profile.contentType) && tts.enabled
  const hasBinding = pronunciation !== undefined
  const status = pronunciation?.snapshot.status ?? null
  const unplayable = pronunciation !== undefined && pronunciation.snapshot.inputReason !== null

  // 화면이 가려지면 발음 훅이 재생을 멈춘다 — 진행도 함께 멈춰 돌아왔을 때 이어 듣게 한다.
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.visibilityState === 'hidden') setPaused(true)
    }
    const pauseOnPageHide = () => setPaused(true)
    document.addEventListener('visibilitychange', pauseWhenHidden)
    window.addEventListener('pagehide', pauseOnPageHide)
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden)
      window.removeEventListener('pagehide', pauseOnPageHide)
    }
  }, [])

  // 단어가 화면에 반영된 뒤 발음을 한 번 요청한다.
  useEffect(() => {
    if (questionId === null || pronunciation === undefined || unplayable) return
    if (revealedRef.current === questionId) return
    revealedRef.current = questionId
    pronunciation.reveal()
  }, [pronunciation, questionId, unplayable])

  useEffect(() => {
    if (questionId === null) return
    let delay: number
    if (!hasBinding) {
      // 발음을 지원하는 세션이면 binding이 곧 붙는다 — 끝내 안 붙을 때만 넘긴다.
      delay = audioSupported ? AUTO_PLAY_STALL_MS : AUTO_PLAY_SILENT_MS
    } else if (unplayable) {
      delay = AUTO_PLAY_SILENT_MS
    } else if (status === 'playing') {
      playedRef.current = questionId
      return
    } else if (status === 'blocked') {
      // 브라우저가 자동 재생을 막았다 — 사용자가 재생 버튼을 눌러야 이어진다.
      setBlocked(true)
      setPaused(true)
      return
    } else if (status === 'error') {
      delay = AUTO_PLAY_ERROR_MS
    } else if (status === 'ready' && playedRef.current === questionId) {
      delay = AUTO_PLAY_GAP_MS
    } else {
      delay = AUTO_PLAY_STALL_MS
    }
    const timer = window.setTimeout(() => {
      if (index + 1 >= words.length) {
        stop('exit')
        setDone(true)
      } else {
        stop('advance')
        setIndex(index + 1)
      }
    }, delay)
    return () => window.clearTimeout(timer)
  }, [audioSupported, hasBinding, index, questionId, status, stop, unplayable, words.length])

  const handleExit = () => {
    stop('exit')
    onExit()
  }

  const togglePaused = () => {
    if (paused) {
      setBlocked(false)
      setEpoch((value) => value + 1)
      setPaused(false)
    } else {
      stop('advance')
      setPaused(true)
    }
  }

  const restart = () => {
    setIndex(0)
    setEpoch((value) => value + 1)
    setBlocked(false)
    setPaused(false)
    setDone(false)
  }

  const lang = headwordLang(profile.contentType)

  return (
    <div className="study autoplay" data-content-type={profile.contentType}>
      <header className="study-header">
        <button type="button" className="study-exit" onClick={handleExit}>
          종료
        </button>
        <div className="study-progress">
          <span className="study-progress-now">{Math.min(index + 1, words.length)}</span>
          <span className="study-progress-total"> / {words.length}</span>
        </div>
        <div className="study-header-spacer" aria-hidden="true" />
      </header>
      <div className="study-chips">
        <span className="study-chip">자동 재생</span>
        {paused && !done && <span className="study-chip study-chip--review">일시정지</span>}
      </div>
      {word === null ? (
        <div className="mode-area mode-area--m2">
          <div className="mode-card mode-card--result">
            <span className="autoplay-done-title">재생이 끝났어요</span>
            <span className="mode-card-hint">{words.length}개 단어를 모두 들었습니다</span>
          </div>
          {words.length > 0 && (
            <button type="button" className="autoplay-secondary-button" onClick={restart}>
              처음부터 다시
            </button>
          )}
          <button type="button" className="primary-button" onClick={handleExit}>
            홈으로
          </button>
        </div>
      ) : (
        <div className="mode-area mode-area--m2">
          <div className="mode-card mode-card--result" key={index}>
            <div className="mode2-result-scroll">
              <span lang={lang} className="mode-card-hanzi">{word.hanzi}</span>
              {(word.pinyin || pronunciation) && (
                <div className={`pinyin-speaker${word.pinyin ? '' : ' pinyin-speaker--no-pinyin'}`}>
                  {word.pinyin && <span className="mode-card-pinyin">{word.pinyin}</span>}
                  {pronunciation && (
                    <div className="pinyin-speaker__button">
                      <PronunciationButton
                        snapshot={pronunciation.snapshot}
                        replay={pronunciation.replay}
                        size="compact"
                      />
                    </div>
                  )}
                </div>
              )}
              <span className="mode-card-meaning">{word.meaning}</span>
            </div>
          </div>
          {blocked && paused && (
            <p className="autoplay-notice" role="status">
              브라우저가 자동 재생을 막았어요. 재생을 눌러 주세요.
            </p>
          )}
          <button type="button" className="primary-button" onClick={togglePaused}>
            {paused ? '재생' : '일시정지'}
          </button>
        </div>
      )}
    </div>
  )
}

export default AutoPlayScreen
