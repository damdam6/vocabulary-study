/** 브라우저·프로필별 자동 재생 화면의 반복 재생 선호. 기본은 끔(목록을 한 번만 재생). */
const key = (profileId: string) => `vocab-study:autoplay-repeat:${encodeURIComponent(profileId)}`;

export function readAutoPlayRepeat(profileId: string): boolean {
  try { return localStorage.getItem(key(profileId)) === "true"; }
  catch { return false; }
}

/** 저장에 실패해도 이번 재생에는 선택이 그대로 적용된다. */
export function saveAutoPlayRepeat(profileId: string, enabled: boolean): void {
  try { localStorage.setItem(key(profileId), String(enabled)); }
  catch { /* 이번 재생에만 적용 */ }
}
