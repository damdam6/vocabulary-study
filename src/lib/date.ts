/**
 * design-prd §3: 홈 화면 상단 날짜, `2026년 7월 17일 금요일` 형식, Asia/Seoul 기준.
 */

const SEOUL_TZ = "Asia/Seoul";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TZ,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

export function formatHomeDate(now: Date = new Date()): string {
  return formatter.format(now);
}
