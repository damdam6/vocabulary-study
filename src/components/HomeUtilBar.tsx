// 홈 상단 유틸 바 (#105, design-prd §3) — 홈 하단 저강조 링크였던 진입 액션 2개를
// 헤더 우측 라운드 사각 아이콘 버튼으로 승격한다. 근거 플랜:
// docs/plans/session-limit-and-home-utils.md §3.4 · §5 작업 D.
//
// 수정 버튼은 팝오버 메뉴 없이 등록 화면으로 즉시 이동한다 — 문제수 필드가 등록
// 화면 상단에 항상 보이므로(#111) 별도 진입 경로가 필요 없어졌다(#112, 메뉴 제거).
interface HomeUtilBarProps {
  onNavigateRegister: () => void
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

function HomeUtilBar({ onNavigateRegister, onSwitchProfile }: HomeUtilBarProps) {
  return (
    <div className="home-util-bar">
      <button type="button" className="home-util-button" aria-label="수정" onClick={onNavigateRegister}>
        <EditIcon />
      </button>

      {/* 프로필 전환 (#78) — v1엔 로그아웃이 없어 다른 프로필로 갈아탈 유일한 경로.
          확인 단계 없이 즉시 전환한다(플랜 Q5). */}
      <button type="button" className="home-util-button" aria-label="프로필 전환" onClick={onSwitchProfile}>
        <PersonIcon />
      </button>
    </div>
  )
}

export default HomeUtilBar
