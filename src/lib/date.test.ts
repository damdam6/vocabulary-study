import { describe, expect, it } from "vitest";
import { formatHomeDate } from "./date.ts";

describe("formatHomeDate", () => {
  it("Asia/Seoul 기준 날짜·요일을 한국어로 포맷한다", () => {
    // 2026-07-17T01:00:00Z → Seoul 2026-07-17 10:00 (금요일)
    expect(formatHomeDate(new Date("2026-07-17T01:00:00.000Z"))).toBe("2026년 7월 17일 금요일");
  });

  it("UTC 기준 서울 자정 직전 인스턴트는 이전 날짜로 표시된다", () => {
    expect(formatHomeDate(new Date("2026-07-19T14:59:00.000Z"))).toBe("2026년 7월 19일 일요일");
  });

  it("UTC 기준 서울 자정 직후 인스턴트는 다음 날짜로 표시된다", () => {
    expect(formatHomeDate(new Date("2026-07-19T15:00:00.000Z"))).toBe("2026년 7월 20일 월요일");
  });
});
