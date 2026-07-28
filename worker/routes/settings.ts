/**
 * POST /api/settings — '_정보' 탭 `문제수` 쓰기 (세션 문제 수 플랜
 * `docs/plans/session-limit-and-home-utils.md` §3.3, #103). 쓰기는 엄격 —
 * 정수 1~500이 아니면 400. 탭 없으면 빈 탭 생성(단어 탭 헤더 복사 없음),
 * `문제수` 행 없으면 첫 빈 행에 추가, 있으면 그 행 B열만 갱신(다른 행·열 불가침).
 * 실패는 재시도 큐 대상이 아니다(설정은 최신 의도만 유효) — 오류 표시는 클라이언트 몫.
 */

import { addSheet, getSheetTitles, getValues, updateValues } from "../lib/sheets.ts";
import {
  MAX_SESSION_LIMIT,
  MIN_SESSION_LIMIT,
  planSessionLimitWrite,
  SETTINGS_RANGE,
  SETTINGS_TAB,
} from "../lib/settings.ts";
import type { Profile } from "../lib/profiles.ts";

function parseSessionLimit(body: unknown): number | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { sessionLimit } = body as Record<string, unknown>;
  if (typeof sessionLimit !== "number" || !Number.isInteger(sessionLimit)) {
    return null;
  }
  if (sessionLimit < MIN_SESSION_LIMIT || sessionLimit > MAX_SESSION_LIMIT) {
    return null;
  }
  return sessionLimit;
}

export async function handleSettingsPost(
  request: Request,
  env: Env,
  profile: Profile,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const sessionLimit = parseSessionLimit(body);
  if (sessionLimit === null) {
    return Response.json(
      { error: `sessionLimit은 ${MIN_SESSION_LIMIT}~${MAX_SESSION_LIMIT} 사이의 정수여야 합니다` },
      { status: 400 },
    );
  }

  // '_정보'는 `_` 접두 탭이라 getWordTabTitles가 걸러낸다 — 존재 확인은 raw 전체 목록으로.
  const titles = await getSheetTitles(env, profile.sheetId);
  let rows: string[][] = [];
  if (!titles.includes(SETTINGS_TAB)) {
    // 키-값 탭이므로 register의 createTab과 달리 헤더 행을 만들지 않는다 (§3.1).
    await addSheet(env, profile.sheetId, SETTINGS_TAB);
  } else {
    rows = await getValues(env, profile.sheetId, SETTINGS_TAB, SETTINGS_RANGE);
  }

  const plan = planSessionLimitWrite(rows, sessionLimit);
  await updateValues(env, profile.sheetId, SETTINGS_TAB, plan.range, plan.values);

  return Response.json({ sessionLimit });
}
