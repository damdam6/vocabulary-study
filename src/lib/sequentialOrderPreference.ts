/**
 * 브라우저·프로필별 "순서대로" 출제 선호. 켜면 홈이 시트 순서 그대로, 풀 수 있는 문제 전부를
 * 큐에 넣는다(buildSequentialQueue). 기본은 끔 — 기존 선별·셔플 큐(buildSessionQueue).
 */
const key = (profileId: string) => `vocab-study:sequential-order:${encodeURIComponent(profileId)}`;

export function readSequentialOrder(profileId: string): boolean {
  try { return localStorage.getItem(key(profileId)) === "true"; }
  catch { return false; }
}

/** 저장에 실패해도 이번 홈 진입 동안은 화면 상태로 적용된다. */
export function saveSequentialOrder(profileId: string, enabled: boolean): void {
  try { localStorage.setItem(key(profileId), String(enabled)); }
  catch { /* 영속만 포기한다 */ }
}
