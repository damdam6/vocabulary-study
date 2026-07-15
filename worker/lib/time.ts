/**
 * PRD 5.4: 모든 날짜·시간은 Asia/Seoul 기준, 타임스탬프 형식은 `YYYY-MM-DD HH:mm`.
 */

const SEOUL_TZ = "Asia/Seoul";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SEOUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `date`를 Asia/Seoul 기준 `YYYY-MM-DD HH:mm` 문자열로 변환한다. */
export function formatSeoulDateTime(date: Date): string {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
