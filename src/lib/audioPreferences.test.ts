// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readAudioAutoplay, saveAudioAutoplay } from "./audioPreferences.ts";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
it("프로필별로 격리하고 미설정 기본값은 ON이다", () => {
  expect(readAudioAutoplay("a")).toBe(true);
  expect(saveAudioAutoplay("a", false)).toBe(true);
  expect(readAudioAutoplay("a")).toBe(false);
  expect(readAudioAutoplay("b")).toBe(true);
});
it("저장소 차단은 학습을 막지 않고 저장 실패를 반환한다", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(readAudioAutoplay("a")).toBe(true);
  expect(saveAudioAutoplay("a", false)).toBe(false);
});
