/**
 * PRD 5.3: 졸업 후 고정 간격 사다리 — 1→3→7→14→30일, 30일 도달 후 유지.
 * POST /api/answer(#8)가 상승 방향 계산을 추가할 때 이 사다리를 그대로 재사용한다.
 */

export const REVIEW_INTERVAL_LADDER = [1, 3, 7, 14, 30];

/**
 * 간격을 사다리에서 한 단계 후퇴시킨다(최소 1일).
 * 시트 수동 편집 등으로 `currentInterval`이 사다리 위 값이 아니어도, 그 값보다 크지 않은
 * 가장 큰 칸을 현재 위치로 보고 그 앞 칸을 반환해 항상 낮은 쪽으로만 안전하게 움직인다.
 */
export function stepBack(currentInterval: number): number {
  let currentIndex = 0;
  for (let i = 0; i < REVIEW_INTERVAL_LADDER.length; i++) {
    if (REVIEW_INTERVAL_LADDER[i] <= currentInterval) {
      currentIndex = i;
    }
  }
  return REVIEW_INTERVAL_LADDER[Math.max(currentIndex - 1, 0)];
}
