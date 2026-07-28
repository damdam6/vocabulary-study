/**
 * '_정보' 설정 탭 순수 로직 — 세션 문제 수 플랜(`docs/plans/session-limit-and-home-utils.md`
 * §3.1·§3.3). 탭 구조: 헤더 행 없음, A열 = 설정 키, B열 = 값, 행 위치 자유.
 * 이 파일은 쓰기 계획(행 탐색)만 담는다 — 읽기 파서(키 탐색·폴백 60)는 병렬 작업 A가
 * 같은 파일에 별도 함수로 추가한다 (§5 — 충돌 최소화를 위해 함수를 분리).
 */

export const SETTINGS_TAB = "_정보";
export const SESSION_LIMIT_KEY = "문제수";
export const SESSION_LIMIT_MIN = 1;
export const SESSION_LIMIT_MAX = 500;

export interface SettingsWritePlan {
  range: string;
  values: (string | number)[][];
}

/**
 * '_정보' 탭 A1:B 읽기 결과로 `문제수` 쓰기 계획을 세운다 (§3.3 — 다른 행·열 불가침).
 * A열 정확 일치(트림)로 행을 찾으면 그 행의 B열만 갱신하고, 없으면 첫 빈 행에
 * `[문제수, 값]` 행을 추가한다. 빈 행 판정은 A·B 모두 빈 행만 — A만 비고 B에 값이
 * 있는 행에 쓰면 그 값을 덮어쓰므로(불가침 위반) 건너뛴다.
 */
export function planSessionLimitWrite(rows: string[][], limit: number): SettingsWritePlan {
  const keyIndex = rows.findIndex((row) => (row[0] ?? "").trim() === SESSION_LIMIT_KEY);
  if (keyIndex !== -1) {
    return { range: `B${keyIndex + 1}`, values: [[limit]] };
  }
  const emptyIndex = rows.findIndex((row) => !(row[0] ?? "").trim() && !(row[1] ?? "").trim());
  const rowNumber = (emptyIndex === -1 ? rows.length : emptyIndex) + 1;
  return { range: `A${rowNumber}:B${rowNumber}`, values: [[SESSION_LIMIT_KEY, limit]] };
}
