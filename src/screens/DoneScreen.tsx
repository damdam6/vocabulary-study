// 세션 결과 화면 (#15, design-prd §5). 상단 요약 카드(정답률·정답/오답 수·비율 막대) 아래에
// 틀린 문제 → 맞힌 문제 순으로 문제별 결과를 나열한다. 필터 같은 조작은 두지 않고, 하단의
// [이미지 저장] [홈] 두 버튼만 누를 수 있다. 수치는 이번 세션의 모드1·2 합산 — X 자가판정도
// 오답으로 집계된다.
//
// 이미지는 화면 진입 시 미리 그려 둔다(renderResultImages) — 저장 버튼은 곧바로 PNG 파일을
// 내려받는다. 문제가 많으면 120개씩 여러 장으로 나뉜다.
import { useEffect, useMemo, useRef, useState } from 'react'
import HomeIcon from '../components/HomeIcon.tsx'
import { headwordLang, modeChipLabel } from '../lib/contentLabels.ts'
import { renderResultImages, saveResultImages, type ResultImageFile, type ResultImageInput } from '../lib/resultImage.ts'
import {
  summarizeResults,
  visibleAnswer,
  type NumberedResult,
} from '../lib/sessionResults.ts'
import type { ContentType, PublicProfile } from '../lib/api.ts'
import type { SessionResult } from './StudyScreen.tsx'

interface DoneScreenProps {
  result: SessionResult
  profile: PublicProfile
  onGoHome: () => void
}

function SaveImageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="18" height="12.5" rx="2.2" />
      <circle cx="8.2" cy="7.4" r="1.4" />
      <path d="M3.6 13.6 8.5 9.7l3.5 2.9 2.6-2.1 5.8 4.2" />
      <path d="M12 17.5V22" />
      <path d="m9.6 19.8 2.4 2.4 2.4-2.4" />
    </svg>
  )
}

function ResultRow({ item, contentType }: { item: NumberedResult; contentType: ContentType }) {
  const lang = headwordLang(contentType)
  const answer = visibleAnswer(item)
  return (
    <li className={`result-row result-row--${item.correct ? 'correct' : 'wrong'}`}>
      <span className="result-mark" role="img" aria-label={item.correct ? '정답' : '오답'}>
        {item.correct ? '✓' : '✕'}
      </span>
      <div className="result-body">
        <div className="result-headline">
          <span className="result-hanzi" lang={lang}>{item.word.hanzi}</span>
          {item.word.pinyin.trim() !== '' && <span className="result-pinyin">{item.word.pinyin}</span>}
        </div>
        <span className="result-meaning">{item.word.meaning}</span>
        {answer !== null && (
          <span className="result-answer">
            <span className="result-answer-label">내 답</span>
            <s lang={lang}>{answer}</s>
          </span>
        )}
        <div className="result-chips">
          {item.isReview && <span className="result-chip result-chip--review">복습</span>}
          <span className="result-chip">{modeChipLabel(contentType, item.mode)}</span>
        </div>
      </div>
    </li>
  )
}

function DoneScreen({ result, profile, onGoHome }: DoneScreenProps) {
  const summary = useMemo(() => summarizeResults(result.results), [result.results])
  const [completedAt] = useState(() => new Date())
  const imageInput = useMemo<ResultImageInput>(
    () => ({ summary, contentType: profile.contentType, profileName: profile.name, completedAt }),
    [summary, profile.contentType, profile.name, completedAt],
  )
  const imageRef = useRef<Promise<ResultImageFile[]> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    const pending = renderResultImages(imageInput)
    pending.catch(() => {})
    imageRef.current = pending
  }, [imageInput])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(false)
    try {
      let files: ResultImageFile[]
      try {
        files = await (imageRef.current ?? renderResultImages(imageInput))
      } catch {
        // 미리 그리기 실패(폰트·메모리 등) — 한 번 더 그려 본다.
        const retry = renderResultImages(imageInput)
        imageRef.current = retry
        files = await retry
      }
      await saveResultImages(files)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  const allCorrect = summary.total > 0 && summary.wrong === 0

  return (
    <div className="result-screen" data-content-type={profile.contentType}>
      <div className="result-scroll">
        <header className="result-header">
          <h2 className="result-title">세션 결과</h2>
        </header>

        <section className="result-summary" aria-label="세션 요약">
          <div className="result-summary-top">
            <div className="result-rate">
              <span className="result-rate-label">정답률</span>
              <span className={`result-rate-value${allCorrect ? ' result-rate-value--perfect' : ''}`}>
                {summary.rate}
                <span className="result-rate-unit">%</span>
              </span>
            </div>
            <div className="result-stats">
              <div className="result-stat">
                <span className="result-stat-num result-stat-num--correct">{summary.correct}</span>
                <span className="result-stat-label">정답</span>
              </div>
              <div className="result-stat-divider" aria-hidden="true" />
              <div className="result-stat">
                <span className={`result-stat-num${summary.wrong > 0 ? ' result-stat-num--wrong' : ''}`}>{summary.wrong}</span>
                <span className="result-stat-label">오답</span>
              </div>
            </div>
          </div>
          {summary.total > 0 && (
            <div className="result-bar" aria-hidden="true">
              {summary.correct > 0 && <span className="result-bar-correct" style={{ flexGrow: summary.correct }} />}
              {summary.wrong > 0 && <span className="result-bar-wrong" style={{ flexGrow: summary.wrong }} />}
            </div>
          )}
          {allCorrect && <p className="result-perfect">이번 세션은 모두 맞혔어요.</p>}
        </section>

        {summary.wrongItems.length > 0 && (
          <section className="result-section" aria-labelledby="result-wrong-title">
            <h3 className="result-section-title" id="result-wrong-title">
              <span className="result-section-dot result-section-dot--wrong" aria-hidden="true" />
              틀린 문제
              <span className="result-section-count result-section-count--wrong">{summary.wrong}</span>
            </h3>
            <ul className="result-list">
              {summary.wrongItems.map((item) => (
                <ResultRow key={item.num} item={item} contentType={profile.contentType} />
              ))}
            </ul>
          </section>
        )}

        {summary.correctItems.length > 0 && (
          <section className="result-section" aria-labelledby="result-correct-title">
            <h3 className="result-section-title" id="result-correct-title">
              <span className="result-section-dot result-section-dot--correct" aria-hidden="true" />
              맞힌 문제
              <span className="result-section-count result-section-count--correct">{summary.correct}</span>
            </h3>
            <ul className="result-list">
              {summary.correctItems.map((item) => (
                <ResultRow key={item.num} item={item} contentType={profile.contentType} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="result-actions">
        {saveError && (
          <p className="result-save-error" role="alert">
            이미지를 저장하지 못했습니다
          </p>
        )}
        <div className="result-action-buttons">
          <button
            type="button"
            className="result-save"
            aria-label="이미지로 저장"
            title="이미지로 저장"
            aria-busy={saving}
            disabled={saving}
            onClick={handleSave}
          >
            <SaveImageIcon />
          </button>
          <button type="button" className="result-home" aria-label="홈으로" title="홈으로" onClick={onGoHome}>
            <HomeIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

export default DoneScreen
