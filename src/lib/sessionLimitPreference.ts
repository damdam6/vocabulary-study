/**
 * 브라우저·프로필별 세션 문제 수 수정값. 홈에서 고친 값을 다음 홈 진입에도 유지한다 —
 * 시트 설정(sessionLimit)은 건드리지 않고, "기본값으로"를 누르면 지워져 시트 값으로 돌아간다.
 */
const key = (profileId: string) => `vocab-study:session-limit:${encodeURIComponent(profileId)}`;

/** 저장된 수정값. 없거나 형태 이상(양의 정수가 아님)·저장소 접근 실패면 null. */
export function readSessionLimitOverride(profileId: string): number | null {
  try {
    const value = Number(localStorage.getItem(key(profileId)));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** null이면 지운다. 저장 실패는 무시한다 — 이번 홈 진입 동안은 화면 상태로 적용된다. */
export function saveSessionLimitOverride(profileId: string, limit: number | null): void {
  try {
    if (limit === null) localStorage.removeItem(key(profileId));
    else localStorage.setItem(key(profileId), String(limit));
  } catch {
    // 저장소 접근 불가(사생활 보호 모드 등) — 영속만 포기한다.
  }
}
