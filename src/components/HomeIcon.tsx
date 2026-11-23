// "홈으로" 버튼에 글자 대신 넣는 집 아이콘 — 버튼의 이름은 aria-label로 전달한다.
function HomeIcon() {
  return (
    <svg
      className="home-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  )
}

export default HomeIcon
