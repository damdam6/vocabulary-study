/**
 * PRD 5.4: 타임스탬프 형식은 Asia/Seoul 기준 `YYYY-MM-DD HH:mm`. worker/lib/time.ts의
 * 클라이언트 미러 — tsconfig.app.json이 src만 포함해 worker 코드를 import할 수 없다.
 * 날짜(YYYY-MM-DD)만 필요한 "오늘" 판정은 wordState.ts의 getSeoulToday를 쓴다.
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
