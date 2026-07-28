/**
 * 시트 안 '_정보' 설정 탭(A열 키 / B열 값) 읽기·쓰기 계획.
 * 사양 원본: `docs/plans/session-limit-and-home-utils.md` §3.1·§3.2·§3.3 (PRD 4.1·6.1·7.3).
 *
 * 탭 이름이 `_`로 시작하므로 기존 "`_` 접두 = 학습 제외" 규약(PRD 4.1)에 그대로 걸린다 —
 * words 출제·tabs 목록·등록 대상에서 이미 자동 제외되어 제외용 코드가 따로 필요 없다.
 *
 * **읽기는 관대하다**: 탭 없음·키 없음·값 이상 어느 경우에도 기본값으로 폴백하고 예외를 밖으로
 * 내보내지 않는다. 손으로 고친 시트의 오타가 GET /api/words 전체를 500으로 떨어뜨리면 안 된다.
 * (쓰기 경로 POST /api/settings는 반대로 엄격하며, 여기 상수·키 탐색을 재사용한다 — 플랜 §3.3.)
 */

import { getValues } from "./sheets.ts";

export const SETTINGS_TAB = "_정보";
// 헤더 행이 없고 키의 행 위치가 자유이므로 A·B열 전체를 읽어 A열에서 키를 찾는다.
export const SETTINGS_RANGE = "A:B";
export const SESSION_LIMIT_KEY = "문제수";
export const DEFAULT_SESSION_LIMIT = 60;
// 쓰기 경로(POST /api/settings)의 엄격 검증도 같은 경계를 쓰므로 export한다 (플랜 §3.3).
export const MIN_SESSION_LIMIT = 1;
export const MAX_SESSION_LIMIT = 500;

export interface SheetSettings {
  /** 세션당 최대 문제 수 (PRD 6.1). 시트 설정이 없거나 이상하면 DEFAULT_SESSION_LIMIT. */
  sessionLimit: number;
}

/**
 * '_정보' 탭 A:B 값을 설정 객체로 정규화한다. 인식하지 않는 키는 무시한다(전방 호환 —
 * 이후 설정 키가 늘어도 구 버전 워커가 죽지 않는다).
 */
export function parseSettings(rows: string[][]): SheetSettings {
  return { sessionLimit: parseSessionLimit(findValue(rows, SESSION_LIMIT_KEY)) };
}

/**
 * '_정보' 탭을 1회 읽어 설정을 만든다. 없는 탭 조회는 Sheets API가 400(Unable to parse range)을
 * 던지는데, 그 외 어떤 실패(권한·5xx·네트워크)도 여기서 기본값으로 흡수한다 — 설정 읽기는
 * words 응답의 부가 정보일 뿐 실패 사유가 아니다.
 */
export async function readSettings(env: Env, sheetId: string): Promise<SheetSettings> {
  try {
    return parseSettings(await getValues(env, sheetId, SETTINGS_TAB, SETTINGS_RANGE));
  } catch (err) {
    // 삼킨 예외가 디버깅을 가리지 않도록 흔적은 남긴다.
    console.warn(`[settings] '${SETTINGS_TAB}' 읽기 실패 — 기본값 사용`, err);
    return { sessionLimit: DEFAULT_SESSION_LIMIT };
  }
}

// A열 키를 트림 후 정확 일치로 찾는다. 같은 키가 여러 행이면 첫 행이 이긴다.
// 뒤쪽 빈 셀은 Sheets API가 생략하므로 B열이 아예 없는(길이 1) 행도 들어온다.
function findValue(rows: string[][], key: string): string | undefined {
  return rows.find((row) => (row[0] ?? "").trim() === key)?.[1];
}

// 정수 판정에 Number()만 쓰면 "0x1E"·"1e2" 같은 표기까지 통과하므로 숫자 문자열 형태를 먼저 강제한다.
function parseSessionLimit(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (!/^\d+$/.test(trimmed)) {
    return DEFAULT_SESSION_LIMIT;
  }
  const value = Number(trimmed);
  if (value < MIN_SESSION_LIMIT || value > MAX_SESSION_LIMIT) {
    return DEFAULT_SESSION_LIMIT;
  }
  return value;
}

export interface SettingsWritePlan {
  range: string;
  values: (string | number)[][];
}

/**
 * '_정보' 탭 A:B 읽기 결과로 `문제수` 쓰기 계획을 세운다 (플랜 §3.3 — 다른 행·열 불가침).
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
