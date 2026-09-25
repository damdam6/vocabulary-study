// 홈 학습 범위 선택 (#189, PRD-tab-scoped-study.md §4.1) — 세그먼트 `전체 | 탭 선택`과
// `탭 선택`일 때 펼치는 다중 선택 탭 칩 목록. Dropdown(#56)은 단일 선택 전용이라 쓰지
// 않는다. 범위·선택은 완전 제어형이고 저장·복원·기본 선택은 호출부(HomeScreen)가
// studyScope.ts로 처리한다 — 이 컴포넌트는 표시와 조작만 맡는다.
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export type StudyScopeKind = 'all' | 'tabs'

export interface StudyScopeTab {
  tab: string
  /** 그 탭만 골랐을 때의 세션 문제 수 — 여러 탭을 고른 결과는 합이 아니라 합집합 기준이라 여기 싣지 않는다. */
  count: number
}

interface StudyScopePickerProps {
  kind: StudyScopeKind
  /** 시트 탭 순서. 칩도 이 순서로 배치하고, onSelectedChange도 이 순서로 올린다. */
  tabs: readonly StudyScopeTab[]
  selected: readonly string[]
  onKindChange: (kind: StudyScopeKind) => void
  onSelectedChange: (selected: string[]) => void
}

const SEGMENTS: readonly { kind: StudyScopeKind; label: string }[] = [
  { kind: 'all', label: '전체' },
  { kind: 'tabs', label: '탭 선택' },
]

// 선택 여부를 색만으로 구분하지 않도록(§4.1) 칩 앞에 원형 표시를 둔다 — 꺼진 칩은 빈 원,
// 켜진 칩은 채운 원 + 체크. 두 상태의 폭이 같아서 토글해도 칩 줄바꿈이 흔들리지 않는다.
function ChipMark({ pressed }: { pressed: boolean }) {
  return (
    <svg className="study-scope-chip-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" />
      {pressed && <path d="M4.8 8.2 7 10.4l4.2-4.6" />}
    </svg>
  )
}

function StudyScopePicker({ kind, tabs, selected, onKindChange, onSelectedChange }: StudyScopePickerProps) {
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedSet = new Set(selected)
  const allSelected = tabs.every(({ tab }) => selectedSet.has(tab))

  // WAI-ARIA 라디오 그룹 패턴: 방향키는 포커스를 옮기면서 곧바로 선택한다(끝에서 순환).
  const handleRadioKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % SEGMENTS.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + SEGMENTS.length) % SEGMENTS.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = SEGMENTS.length - 1
    } else {
      return
    }
    event.preventDefault()
    onKindChange(SEGMENTS[next].kind)
    radioRefs.current[next]?.focus()
  }

  const toggleTab = (tab: string) => {
    const next = new Set(selectedSet)
    if (next.has(tab)) {
      next.delete(tab)
    } else {
      next.add(tab)
    }
    onSelectedChange(tabs.filter((entry) => next.has(entry.tab)).map((entry) => entry.tab))
  }

  const toggleAll = () => {
    onSelectedChange(allSelected ? [] : tabs.map((entry) => entry.tab))
  }

  return (
    <div className="study-scope">
      <div className="study-scope-segment" role="radiogroup" aria-label="학습 범위">
        {SEGMENTS.map((segment, index) => {
          const checked = segment.kind === kind
          return (
            <button
              key={segment.kind}
              ref={(node) => {
                radioRefs.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="study-scope-segment-option"
              onClick={() => onKindChange(segment.kind)}
              onKeyDown={(event) => handleRadioKeyDown(event, index)}
            >
              {segment.label}
            </button>
          )
        })}
      </div>

      {kind === 'tabs' && (
        <>
          <div className="study-scope-toolbar">
            <button type="button" className="study-scope-toggle-all" onClick={toggleAll}>
              {allSelected ? '선택 해제' : '모두 선택'}
            </button>
          </div>
          <div className="study-scope-chips" role="group" aria-label="학습할 탭">
            {tabs.map(({ tab, count }) => {
              const pressed = selectedSet.has(tab)
              const className = [
                'study-scope-chip',
                pressed ? 'is-selected' : '',
                count === 0 ? 'is-empty' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={tab}
                  type="button"
                  className={className}
                  aria-pressed={pressed}
                  title={tab}
                  onClick={() => toggleTab(tab)}
                >
                  <ChipMark pressed={pressed} />
                  <span className="study-scope-chip-label">
                    <span className="study-scope-chip-name">{tab}</span>
                    <span className="study-scope-chip-count"> · {count}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default StudyScopePicker
