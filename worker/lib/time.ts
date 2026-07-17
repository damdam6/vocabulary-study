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

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SEOUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** `date`를 Asia/Seoul 기준 `YYYY-MM-DD HH:mm` 문자열로 변환한다. */
export function formatSeoulDateTime(date: Date): string {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** `date`를 Asia/Seoul 기준 `YYYY-MM-DD` 문자열로 변환한다. */
export function formatSeoulDate(date: Date): string {
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// 한국은 DST가 없어 UTC ms 덧셈만으로도 Asia/Seoul 달력 날짜가 어긋나지 않는다.
/** `date`로부터 Asia/Seoul 기준 `days`일 후의 날짜(`YYYY-MM-DD`)를 반환한다. */
export function addSeoulDays(date: Date, days: number): string {
  return formatSeoulDate(new Date(date.getTime() + days * DAY_MS));
}
