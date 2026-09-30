// 홈 상단 유틸 바 (#105, design-prd §3) — 홈 하단 저강조 링크였던 진입 액션 2개를
// 헤더 우측 라운드 사각 아이콘 버튼으로 승격한다. 근거 플랜:
// docs/plans/session-limit-and-home-utils.md §3.4 · §5 작업 D.
//
import { useEffect, useId, useRef, useState } from "react"

interface HomeUtilBarProps {
  onNavigateRegister: () => void
  onNavigateTabModes?: () => void
  onSwitchProfile: () => void
  audioAutoplay?: boolean
  onToggleAudio?: () => void
}

// 아이콘은 인라인 SVG 자체 제작 — 아이콘 라이브러리 도입 없음(플랜 §8 결정).
// stroke를 currentColor로 두어 버튼의 color만 바꾸면 hover 톤이 따라온다.
function EditIcon() {
  return (
    <svg
      className="home-util-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 노트 — 연필이 지나가는 우상단 모서리는 비워 둔다 */}
      <path d="M13 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12" />
      <path d="M8.5 9.5h4.5" />
      <path d="M8.5 13.5h3" />
      {/* 연필 — 몸통 평행사변형 + 촉 */}
      <path d="M17.8 3.2a1.7 1.7 0 0 1 2.4 2.4l-6.6 6.6-3 .6.6-3z" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg
      className="home-util-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 상반신 실루엣 — 머리 + 어깨 */}
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  )
}

function HomeUtilBar({ onNavigateRegister, onSwitchProfile, onNavigateTabModes, audioAutoplay, onToggleAudio }: HomeUtilBarProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  return (
    <div className="home-util-bar">
      {onToggleAudio && (
        <button type="button" className="home-util-button home-audio-button" aria-label="발음 자동 재생" aria-pressed={audioAutoplay} onClick={onToggleAudio}>
          <svg className="home-util-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M4.5 9.5v5h3l4 3.5V6l-4 3.5z" />
            {audioAutoplay ? (
              <><path d="M15 9a4 4 0 0 1 0 6" /><path d="M17.5 6.5a7.5 7.5 0 0 1 0 11" /></>
            ) : (
              <path d="m3 3 18 18" />
            )}
          </svg>
        </button>
      )}

      <div className="home-edit-menu" ref={menuRef} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }} onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setOpen(false)
          triggerRef.current?.focus()
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          if (!open) { setOpen(true); return }
          const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }
      }}>
        <button ref={triggerRef} type="button" className="home-util-button" aria-label="수정" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
          <EditIcon />
        </button>
        {open && <div id={menuId} className="home-edit-menu-panel" role="menu" aria-label="등록 및 문제 유형 설정">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onNavigateRegister() }}>어휘/문장 등록</button>
          {onNavigateTabModes && <button type="button" role="menuitem" onClick={() => { setOpen(false); onNavigateTabModes() }}>탭별 문제 유형 설정</button>}
        </div>}
      </div>

      {/* 프로필 전환 (#78) — v1엔 로그아웃이 없어 다른 프로필로 갈아탈 유일한 경로.
          확인 단계 없이 즉시 전환한다(플랜 Q5). */}
      <button type="button" className="home-util-button" aria-label="프로필 전환" onClick={onSwitchProfile}>
        <PersonIcon />
      </button>
    </div>
  )
}

export default HomeUtilBar
