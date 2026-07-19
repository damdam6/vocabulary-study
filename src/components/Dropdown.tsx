// 커스텀 드롭다운 (#56) — 네이티브 <select>를 design-prd §1 토큰 기반 UI로 대체하는
// 재사용 가능한 리스트박스 버튼 패턴 컴포넌트. 선택값은 완전 제어형(value/onChange)이고,
// 열림 여부·키보드 하이라이트만 내부 상태로 둔다.
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  id?: string
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
}

function Dropdown({ id, value, options, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listboxId = useId()

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : ''

  // 바깥 클릭/ESC로 닫힘 — 패널이 열려 있을 때만 리스너를 붙여 다른 UI에 영향을 주지 않는다.
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const openList = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  const selectOption = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openList()
    }
  }

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectOption(activeIndex)
    }
  }

  return (
    <div className="dropdown" ref={containerRef}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="dropdown-trigger-label">{selectedLabel}</span>
        <span className={`dropdown-chevron${open ? ' dropdown-chevron--open' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={listboxId}
          ref={listRef}
          className="dropdown-panel"
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`${listboxId}-option-${activeIndex}`}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`dropdown-option${option.value === value ? ' dropdown-option--selected' : ''}${
                index === activeIndex ? ' dropdown-option--active' : ''
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Dropdown
