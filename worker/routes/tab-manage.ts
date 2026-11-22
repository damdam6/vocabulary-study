/**
 * 탭 관리 화면 API.
 *
 * GET  /api/tab-manage → `{ tabs: ManagedTab[] }` — 비활성 탭을 포함한 모든 학습 탭(시트 순서).
 * POST /api/tab-manage ← `{ action: "save", tabs: [{ id, modes, disabled }], order?: number[] }`
 *                         출제 유형·비활성 여부·탭 순서를 한 번에 저장한다.
 *                      ← `{ action: "rename", id, name }` 탭 이름을 바꾼다(단어·기록·설정은 그대로).
 *                      ← `{ action: "delete", id }` 탭과 그 안의 단어·학습 기록을 지우고 싱크한다.
 *                      ← `{ action: "sync" }` `_정보`의 낡은 탭 설정을 정리한다(lib/tabSync.ts).
 * 응답은 모두 GET과 같은 목록이며 delete·sync는 `removed`(정리한 항목 수)를 덧붙인다.
 * 탭 생성은 기존 POST /api/tabs를 쓴다. 탭 식별은 Google Sheets 탭 ID라 이름이 바뀌어도 유지된다.
 */

import { isStudyModes, type ManagedTab, type StudyMode } from "../../shared/studyModes.ts";
import type { Profile } from "../lib/profiles.ts";
import { normalizeTabName } from "../lib/register.ts";
import { addSheet, appendValues, batchUpdateSpreadsheet, type MoveSheetRequest } from "../lib/sheets.ts";
import { SETTINGS_RANGE, SETTINGS_TAB } from "../lib/settings.ts";
import { readTabModes, readTabModesWith, tabDisabledKey, tabModesKey } from "../lib/tabModes.ts";
import { applyTabSync, planTabSync } from "../lib/tabSync.ts";

const STALE = "탭이 변경되었습니다. 다시 불러와 주세요.";

function bad(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

async function listTabs(env: Env, profile: Profile): Promise<ManagedTab[]> {
  const { tabs, disabledIds, extra } = await readTabModesWith(env, profile, (names) =>
    names.map((tab) => ({ tab, range: "A2:A" })));
  return tabs.map((tab, i) => ({ ...tab, disabled: disabledIds.has(tab.id), wordCount: extra[i].length }));
}

async function listResponse(env: Env, profile: Profile, extra: Record<string, unknown> = {}): Promise<Response> {
  return Response.json({ tabs: await listTabs(env, profile), ...extra }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * 학습 탭을 원하는 순서로 놓는 이동 요청 목록. `_` 탭은 제자리에 두고 학습 탭이 차지하던
 * 자리만 새 순서로 채운다. 앞자리부터 확정하므로 모든 이동이 왼쪽 방향이라, "이동 전 기준"인
 * Sheets index 규약에서도 목표 위치를 그대로 쓸 수 있다.
 */
export function planReorder(sheets: { id: number; name: string }[], order: number[]): MoveSheetRequest[] {
  const current = sheets.map((sheet) => sheet.id);
  const queue = [...order];
  const target = sheets.map((sheet) => (sheet.name.startsWith("_") ? sheet.id : queue.shift()!));
  const requests: MoveSheetRequest[] = [];
  target.forEach((id, index) => {
    const from = current.indexOf(id);
    if (from === index) return;
    current.splice(from, 1);
    current.splice(index, 0, id);
    requests.push({ updateSheetProperties: { properties: { sheetId: id, index }, fields: "index" } });
  });
  return requests;
}

async function syncSettings(env: Env, profile: Profile): Promise<number> {
  const { tabs, sheets, settingsRows } = await readTabModes(env, profile);
  const settingsGid = sheets.find((sheet) => sheet.name === SETTINGS_TAB)?.id;
  if (settingsGid === undefined) return 0;
  const plan = planTabSync(settingsRows, new Set(tabs.map((tab) => tab.id)));
  await applyTabSync(env, profile.sheetId, settingsGid, plan);
  return plan.prunedEntries + plan.staleRows.length;
}

interface SaveEntry {
  id: number;
  modes: StudyMode[];
  disabled: boolean;
}

function isTabId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

async function save(env: Env, profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const entries = body.tabs;
  if (!Array.isArray(entries) || entries.some((item) => !item || !isTabId(item.id) || !isStudyModes(item.modes)
    || typeof item.disabled !== "boolean") || new Set(entries.map((item) => item.id)).size !== entries.length) {
    return bad("각 탭에 뜻 보기 또는 쓰기를 하나 이상 선택하세요.");
  }
  const order = body.order;
  if (order !== undefined && (!Array.isArray(order) || !order.every(isTabId) || new Set(order).size !== order.length)) {
    return bad("탭 순서가 올바르지 않습니다.");
  }

  const { tabs, hasSettings, sheets, disabledIds } = await readTabModes(env, profile);
  const current = new Map(tabs.map((tab) => [tab.id, tab]));
  if ((entries as SaveEntry[]).some((item) => !current.has(item.id))) return bad(STALE, 409);
  // 순서는 현재 학습 탭 전체의 순열이어야 한다 — 그 사이 탭이 생기거나 지워졌으면 다시 불러오게 한다.
  if (order && (order.length !== tabs.length || order.some((id) => !current.has(id)))) return bad(STALE, 409);

  // 제출된 탭만 덮어쓰고 나머지 살아 있는 탭 설정은 보존하며, 삭제된 ID는 새 스냅샷에서 빠진다.
  const modes: Record<string, StudyMode[]> = Object.fromEntries(
    tabs.filter((tab) => tab.explicit).map((tab) => [tab.id, tab.modes]));
  const disabled = new Set(tabs.filter((tab) => disabledIds.has(tab.id)).map((tab) => tab.id));
  for (const item of entries as SaveEntry[]) {
    modes[String(item.id)] = item.modes;
    if (item.disabled) disabled.add(item.id);
    else disabled.delete(item.id);
  }
  if (!hasSettings) await addSheet(env, profile.sheetId, SETTINGS_TAB);
  await appendValues(env, profile.sheetId, SETTINGS_TAB, SETTINGS_RANGE, [
    [tabModesKey(profile.id), JSON.stringify(modes)],
    [tabDisabledKey(profile.id), JSON.stringify([...disabled])],
  ]);

  const moves = order ? planReorder(sheets, order as number[]) : [];
  if (moves.length > 0) await batchUpdateSpreadsheet(env, profile.sheetId, moves);
  return listResponse(env, profile);
}

async function rename(env: Env, profile: Profile, body: Record<string, unknown>): Promise<Response> {
  if (!isTabId(body.id)) return bad("이름을 바꿀 탭이 올바르지 않습니다.");
  const nameResult = normalizeTabName(body.name);
  if ("error" in nameResult) return bad(nameResult.error);
  const { tabs, sheets } = await readTabModes(env, profile);
  const target = tabs.find((tab) => tab.id === body.id);
  if (!target) return bad(STALE, 409);
  if (target.name !== nameResult.name) {
    // 시트 안에서 탭 이름은 유일해야 한다(`_` 탭 포함).
    if (sheets.some((sheet) => sheet.name === nameResult.name)) return bad("같은 이름의 탭이 이미 있습니다.", 409);
    await batchUpdateSpreadsheet(env, profile.sheetId, [
      { updateSheetProperties: { properties: { sheetId: target.id, title: nameResult.name }, fields: "title" } },
    ]);
  }
  return listResponse(env, profile);
}

async function remove(env: Env, profile: Profile, body: Record<string, unknown>): Promise<Response> {
  if (!isTabId(body.id)) return bad("삭제할 탭이 올바르지 않습니다.");
  const { tabs, sheets } = await readTabModes(env, profile);
  if (!tabs.some((tab) => tab.id === body.id)) return bad(STALE, 409);
  // Sheets는 스프레드시트의 마지막 탭을 지울 수 없다.
  if (sheets.length <= 1) return bad("마지막 남은 탭은 삭제할 수 없습니다.", 409);
  await batchUpdateSpreadsheet(env, profile.sheetId, [{ deleteSheet: { sheetId: body.id } }]);
  // 탭은 이미 지워졌으므로 싱크가 실패해도 삭제는 성공으로 답한다 — 남은 값은 다음 싱크가 정리한다.
  let removed = 0;
  try {
    removed = await syncSettings(env, profile);
  } catch (err) {
    console.error("[tab-manage] sync after delete failed", err);
  }
  return listResponse(env, profile, { removed });
}

export async function handleTabManage(request: Request, env: Env, profile: Profile): Promise<Response> {
  if (request.method === "GET") return listResponse(env, profile);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("잘못된 JSON입니다.");
  }
  if (typeof body !== "object" || body === null) return bad("action이 필요합니다.");
  const payload = body as Record<string, unknown>;
  if (payload.action === "save") return save(env, profile, payload);
  if (payload.action === "rename") return rename(env, profile, payload);
  if (payload.action === "delete") return remove(env, profile, payload);
  if (payload.action === "sync") return listResponse(env, profile, { removed: await syncSettings(env, profile) });
  return bad("알 수 없는 action입니다.");
}
