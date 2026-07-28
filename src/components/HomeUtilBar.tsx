// 홈 상단 유틸 바 (#105, design-prd §3) — 홈 하단 저강조 링크였던 진입 액션 2개를
// 헤더 우측 라운드 사각 아이콘 버튼으로 승격한다. 근거 플랜:
// docs/plans/session-limit-and-home-utils.md §3.4 · §5 작업 D.
//
// 수정 메뉴 옵션은 "단어 등록"·"1회 문제 수 수정" 둘이다(§5 작업 E, #110) — 둘 다
// 등록 화면(RegisterScreen)으로 이동하고, 후자는 상단 문제수 필드에 포커스를 준다
// (App.tsx의 focusSessionLimit 배선). 옵션이 늘어날 자리는 menuItems 배열 하나.
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

interface HomeUtilBarProps {
  onNavigateRegister: () => void
  onEditSessionLimit: () => void
  onSwitchProfile: () => void
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

function HomeUtilBar({ onNavigateRegister, onEditSessionLimit, onSwitchProfile }: HomeUtilBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  const menuItems = [
    { label: '단어 등록', onSelect: onNavigateRegister },
    { label: '1회 문제 수 수정', onSelect: onEditSessionLimit },
  ]

  // 바깥 탭/ESC로 닫힘 — 커스텀 드롭다운과 같은 패턴(#66). click이 아니라 pointerdown인
  // 이유는 터치 환경에서 click이 늦게 오거나 스크롤로 취소되기 때문(#65). 트리거가 이
  // 컨테이너 안에 있으므로 열린 상태에서 트리거를 다시 눌러도 여기서 닫히지 않고
  // onClick 토글이 처리한다. 열려 있을 때만 리스너를 붙여 다른 UI에 영향을 주지 않는다.
  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  // 열리면 첫 항목으로 포커스 — role="menu"의 기본 기대 동작
  useEffect(() => {
    if (menuOpen) itemRefs.current[0]?.focus()
  }, [menuOpen])

  const selectItem = (onSelect: () => void) => {
    setMenuOpen(false)
    onSelect()
  }

  // 항목 간 이동은 포커스 기준 — 옵션이 하나인 지금은 사실상 no-op이지만
  // 작업 E에서 옵션이 늘어나도 그대로 동작한다.
  const moveFocus = (delta: number) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    if (items.length === 0) return
    const current = items.findIndex((item) => item === document.activeElement)
    // 포커스가 메뉴 밖이면 방향과 무관하게 첫 항목으로 — -1을 그대로 모듈러에 넣으면
    // ArrowUp이 엉뚱한 항목에 떨어진다.
    if (current === -1) {
      items[0].focus()
      return
    }
    items[(current + delta + items.length) % items.length].focus()
  }

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setMenuOpen(true)
    }
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
    }
  }

  return (
    <div className="home-util-bar">
      <div className="home-util-menu-wrap" ref={menuWrapRef}>
        <button
          ref={triggerRef}
          type="button"
          className="home-util-button"
          aria-label="수정"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((open) => !open)}
          onKeyDown={handleTriggerKeyDown}
        >
          <EditIcon />
        </button>

        {menuOpen && (
          <ul id={menuId} className="home-util-menu" role="menu" aria-label="수정" onKeyDown={handleMenuKeyDown}>
            {menuItems.map((item, index) => (
              <li key={item.label} role="none">
                <button
                  ref={(node) => {
                    itemRefs.current[index] = node
                  }}
                  type="button"
                  role="menuitem"
                  className="home-util-menu-item"
                  onClick={() => selectItem(item.onSelect)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
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
