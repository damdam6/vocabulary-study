/**
 * Google Sheets API v4 래퍼 — values.get / update / append.
 * 모든 호출은 탭 이름 + A1 표기 범위를 받고, 비 2xx 응답은 SheetsApiError로 throw한다.
 */

import { getAccessToken } from "./google-auth.ts";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, action: string) {
    super(`Sheets API ${action} failed: ${status} ${body}`);
    this.name = "SheetsApiError";
    this.status = status;
    this.body = body;
  }
}

export interface UpdateResult {
  updatedRange: string;
  updatedRows?: number;
  updatedColumns?: number;
  updatedCells?: number;
}

export interface AppendResult {
  updates: UpdateResult;
}

export interface BatchUpdateResult {
  totalUpdatedCells?: number;
  responses?: UpdateResult[];
}

/** 지정 범위의 값을 읽는다. 빈 범위는 빈 배열. 뒤쪽 빈 셀은 API가 생략하므로 행 길이가 다를 수 있다. */
export async function getValues(env: Env, tab: string, range: string): Promise<string[][]> {
  const res = await sheetsFetch(env, "GET", `/values/${encodeRange(tab, range)}`);
  const body = (await res.json()) as { values?: string[][] };
  return body.values ?? [];
}

/** 스프레드시트의 모든 탭 제목을 순서대로 반환한다. */
export async function getSheetTitles(env: Env): Promise<string[]> {
  const res = await sheetsFetch(env, "GET", "?fields=sheets.properties.title");
  const body = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
  return (body.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => !!title);
}

/** 지정 범위에 값을 덮어쓴다. RAW: 문자열을 그대로 저장 (PRD의 `날짜|간격` 같은 텍스트 계약 보호). */
export async function updateValues(
  env: Env,
  tab: string,
  range: string,
  values: (string | number)[][],
): Promise<UpdateResult> {
  const res = await sheetsFetch(
    env,
    "PUT",
    `/values/${encodeRange(tab, range)}?valueInputOption=RAW`,
    { values },
  );
  return (await res.json()) as UpdateResult;
}

/**
 * 여러 범위를 한 번의 API 호출로 덮어쓴다. 정답 기록처럼 셀 여러 개가 한 단위인 쓰기에서
 * 부분 실패(카운트만 반영되고 타임스탬프 누락 등)를 막기 위해 개별 update 대신 이걸 쓴다.
 */
export async function batchUpdateValues(
  env: Env,
  tab: string,
  updates: { range: string; values: (string | number)[][] }[],
): Promise<BatchUpdateResult> {
  const res = await sheetsFetch(env, "POST", "/values:batchUpdate", {
    valueInputOption: "RAW",
    data: updates.map(({ range, values }) => ({ range: fullRange(tab, range), values })),
  });
  return (await res.json()) as BatchUpdateResult;
}

/** 지정 범위가 속한 표의 마지막 행 뒤에 새 행(들)을 추가한다. */
export async function appendValues(
  env: Env,
  tab: string,
  range: string,
  values: (string | number)[][],
): Promise<AppendResult> {
  const res = await sheetsFetch(
    env,
    "POST",
    `/values/${encodeRange(tab, range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values },
  );
  return (await res.json()) as AppendResult;
}

// 탭 이름은 한글('HSK6급')일 수 있어 작은따옴표로 감싼다.
function fullRange(tab: string, range: string): string {
  return `'${tab.replaceAll("'", "''")}'!${range}`;
}

// URL 경로에 들어가는 범위는 전체를 URL 인코딩한다.
// 인코딩을 호출자에게 맡기면 누락 시 400이므로 여기서 강제한다.
function encodeRange(tab: string, range: string): string {
  return encodeURIComponent(fullRange(tab, range));
}

async function sheetsFetch(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const token = await getAccessToken(env);
  const res = await fetch(`${API_BASE}/${env.SHEET_ID}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new SheetsApiError(res.status, await res.text(), `${method} ${decodeURIComponent(path)}`);
  }
  return res;
}
