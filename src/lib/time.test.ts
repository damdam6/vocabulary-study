import { describe, expect, it } from "vitest";
import { formatSeoulDateTime } from "./time";

describe("formatSeoulDateTime", () => {
  it("UTC Date를 Asia/Seoul 기준 YYYY-MM-DD HH:mm으로 변환한다", () => {
    expect(formatSeoulDateTime(new Date("2026-07-13T00:12:00Z"))).toBe("2026-07-13 09:12");
  });

  it("서울 자정을 넘는 시각이면 날짜도 넘어간다", () => {
    expect(formatSeoulDateTime(new Date("2026-07-12T16:10:00Z"))).toBe("2026-07-13 01:10");
  });

  it("한 자리 월·일·시·분을 zero-padding한다", () => {
    expect(formatSeoulDateTime(new Date("2026-01-02T22:05:00Z"))).toBe("2026-01-03 07:05");
  });
});
