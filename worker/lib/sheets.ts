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
export async function getValues(
  env: Env,
  sheetId: string,
  tab: string,
  range: string,
): Promise<string[][]> {
  const res = await sheetsFetch(env, sheetId, "GET", `/values/${encodeRange(tab, range)}`);
  const body = (await res.json()) as { values?: string[][] };
  return body.values ?? [];
}

export interface RangeRef {
  tab: string;
  /** 생략하면 탭 전체(1행 헤더 포함). */
  range?: string;
}

/**
 * 여러 범위를 한 번의 API 호출로 읽는다 — 결과는 요청한 ranges와 같은 순서.
 * Sheets 읽기 쿼터(분당 60회/사용자)는 요청 수 기준이라, 범위마다 values.get을
 * 부르는 대신 이걸 쓰면 탭 수와 무관하게 1회로 센다.
 */
export async function batchGetValues(
  env: Env,
  sheetId: string,
  ranges: RangeRef[],
): Promise<string[][][]> {
  if (ranges.length === 0) {
    return [];
  }
  const query = ranges
    .map(({ tab, range }) => `ranges=${encodeURIComponent(range === undefined ? quoteTab(tab) : fullRange(tab, range))}`)
    .join("&");
  const res = await sheetsFetch(env, sheetId, "GET", `/values:batchGet?${query}`);
  const body = (await res.json()) as { valueRanges?: { values?: string[][] }[] };
  return ranges.map((_, i) => body.valueRanges?.[i]?.values ?? []);
}

/** 스프레드시트의 모든 탭 제목을 순서대로 반환한다. */
export async function getSheetTitles(env: Env, sheetId: string): Promise<string[]> {
  const res = await sheetsFetch(env, sheetId, "GET", "?fields=sheets.properties.title");
  const body = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
  return (body.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => !!title);
}

/** Stable tab IDs survive renames; deleted/recreated tabs receive a new ID. */
export async function getSheetMetadata(env: Env, sheetId: string): Promise<{ id: number; name: string }[]> {
  const res = await sheetsFetch(env, sheetId, "GET", "?fields=sheets.properties(sheetId,title)");
  const body = await res.json() as { sheets?: { properties: { sheetId: number; title: string } }[] };
  return (body.sheets ?? []).map(({ properties }) => {
    if (!Number.isInteger(properties.sheetId) || properties.sheetId < 0 || typeof properties.title !== "string") {
      throw new Error("Invalid sheet metadata");
    }
    return { id: properties.sheetId, name: properties.title };
  });
}

// Sheets API batchUpdate request 형태 — 이 코드베이스가 실제로 보내는 종류만 다룬다.
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate
export interface AddSheetRequest {
  addSheet: {
    properties: {
      title: string;
      sheetId?: number;
      gridProperties?: { frozenRowCount?: number };
    };
  };
}

export interface Rgb {
  red: number;
  green: number;
  blue: number;
}

export interface RepeatCellRequest {
  repeatCell: {
    range: {
      sheetId: number;
      startRowIndex?: number;
      endRowIndex?: number;
      startColumnIndex?: number;
      endColumnIndex?: number;
    };
    cell: { userEnteredFormat: { backgroundColor: Rgb } };
    fields: string;
  };
}

/** 탭 삭제 — 탭의 모든 셀·학습 기록이 함께 사라진다(되돌릴 수 없음). */
export interface DeleteSheetRequest {
  deleteSheet: { sheetId: number };
}

/** 탭 위치 이동. index는 "이동 전" 기준 위치다(Sheets API 규약). */
export interface MoveSheetRequest {
  updateSheetProperties: { properties: { sheetId: number; index: number }; fields: "index" };
}

/** 행 삭제(0-기준, endIndex 미포함). `_정보` 탭의 낡은 설정 행 정리에 쓴다. */
export interface DeleteRowsRequest {
  deleteDimension: { range: { sheetId: number; dimension: "ROWS"; startIndex: number; endIndex: number } };
}

export type SpreadsheetRequest =
  | AddSheetRequest
  | RepeatCellRequest
  | DeleteSheetRequest
  | MoveSheetRequest
  | DeleteRowsRequest;

// 값(`/values:batchUpdate`)이 아니라 스프레드시트 구조·서식을 바꾸는 별도 엔드포인트.
/** 구조/서식 request 배열을 한 번의 batchUpdate로 전송한다. request는 배열 순서대로 처리된다. */
export async function batchUpdateSpreadsheet(
  env: Env,
  sheetId: string,
  requests: SpreadsheetRequest[],
): Promise<void> {
  await sheetsFetch(env, sheetId, "POST", ":batchUpdate", { requests });
}

/** 서식 없는 새 탭을 생성한다. `_정보` 탭 생성(settings)이 사용한다 — 단어 탭은 lib/tabs.ts가 서식과 함께 만든다(#122). */
export async function addSheet(env: Env, sheetId: string, title: string): Promise<void> {
  await batchUpdateSpreadsheet(env, sheetId, [{ addSheet: { properties: { title } } }]);
}

/** 지정 범위에 값을 덮어쓴다. RAW: 문자열을 그대로 저장 (PRD의 `날짜|간격` 같은 텍스트 계약 보호). */
export async function updateValues(
  env: Env,
  sheetId: string,
  tab: string,
  range: string,
  values: (string | number)[][],
): Promise<UpdateResult> {
  const res = await sheetsFetch(
    env,
    sheetId,
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
  sheetId: string,
  tab: string,
  updates: { range: string; values: (string | number)[][] }[],
): Promise<BatchUpdateResult> {
  const res = await sheetsFetch(env, sheetId, "POST", "/values:batchUpdate", {
    valueInputOption: "RAW",
    data: updates.map(({ range, values }) => ({ range: fullRange(tab, range), values })),
  });
  return (await res.json()) as BatchUpdateResult;
}

/** 지정 범위가 속한 표의 마지막 행 뒤에 새 행(들)을 추가한다. */
export async function appendValues(
  env: Env,
  sheetId: string,
  tab: string,
  range: string,
  values: (string | number)[][],
): Promise<AppendResult> {
  const res = await sheetsFetch(
    env,
    sheetId,
    "POST",
    `/values/${encodeRange(tab, range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values },
  );
  return (await res.json()) as AppendResult;
}

// 탭 이름은 한글('HSK6급')일 수 있어 작은따옴표로 감싼다.
function quoteTab(tab: string): string {
  return `'${tab.replaceAll("'", "''")}'`;
}

function fullRange(tab: string, range: string): string {
  return `${quoteTab(tab)}!${range}`;
}

// URL 경로에 들어가는 범위는 전체를 URL 인코딩한다.
// 인코딩을 호출자에게 맡기면 누락 시 400이므로 여기서 강제한다.
function encodeRange(tab: string, range: string): string {
  return encodeURIComponent(fullRange(tab, range));
}

// 재시도 전 대기(ms). 429(분당 쿼터)·일시적 5xx 한 번에 요청 전체가 500으로 떨어지지 않게 한다.
const RETRY_DELAYS_MS = [300, 900];

// 429는 요청이 처리되지 않았으므로 메서드와 무관하게 재시도해도 안전하다.
// 5xx는 서버가 쓰기를 반영했을 수 있어(append 중복 위험) 읽기(GET)만 재시도한다.
function isRetryable(method: string, status: number): boolean {
  return status === 429 || (method === "GET" && status >= 500);
}

async function sheetsFetch(
  env: Env,
  sheetId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const token = await getAccessToken(env);
  const action = `${method} ${decodeURIComponent(path)}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}/${sheetId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) {
      return res;
    }
    const errorBody = await res.text();
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined && isRetryable(method, res.status)) {
      console.warn(`[sheets] ${action} -> ${res.status}, retry ${attempt + 1}/${RETRY_DELAYS_MS.length}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    // Workers Logs가 Error 객체를 스택만 남기고 메시지를 떨어뜨리는 경우가 있어 상태·본문을 문자열로 따로 남긴다.
    console.error(`[sheets] ${action} failed: ${res.status} ${errorBody.slice(0, 500)}`);
    throw new SheetsApiError(res.status, errorBody, action);
  }
}
