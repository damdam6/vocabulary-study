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

/** `date`를 Asia/Seoul 기준 `YYYY-MM-DD` 문자열로 변환한다. */
export function formatSeoulDate(date: Date): string {
  return formatSeoulDateTime(date).slice(0, 10);
}

// Asia/Seoul은 DST가 없는 고정 UTC+9라, 추출한 서울 달력 날짜를 그대로 UTC 앵커로 다뤄도
// 일 단위 가감산이 타임존 경계 없이 정확하다.
/** `YYYY-MM-DD` 문자열에 `days`일을 더한 `YYYY-MM-DD` 문자열을 반환한다. */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  const y = anchor.getUTCFullYear();
  const m = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  const d = String(anchor.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
