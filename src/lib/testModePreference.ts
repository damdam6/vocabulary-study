/**
 * 브라우저·프로필별 "시험모드" 선호. 켜면 홈이 범위 안 단어를 졸업 단어까지 전부 한 번씩 출제하고
 * (buildTestQueue), 시트 학습 기록은 남기지 않으며, 끝나면 문제별 결과 화면을 보여 준다.
 * 기본은 끔.
 */
const key = (profileId: string) => `vocab-study:test-mode:${encodeURIComponent(profileId)}`;

export function readTestMode(profileId: string): boolean {
  try { return localStorage.getItem(key(profileId)) === "true"; }
  catch { return false; }
}

/** 저장에 실패해도 이번 홈 진입 동안은 화면 상태로 적용된다. */
export function saveTestMode(profileId: string, enabled: boolean): void {
  try { localStorage.setItem(key(profileId), String(enabled)); }
  catch { /* 영속만 포기한다 */ }
}
