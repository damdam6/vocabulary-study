/**
 * 탭 싱크 — `_정보` 탭에 남은 탭 ID 기반 설정(탭출제유형·탭비활성)을 실제 탭 목록에 맞춘다.
 *
 * 설정 저장은 스냅샷 행을 append만 하므로 예전 행과 삭제된 탭의 ID가 시트에 계속 보인다.
 * 싱크는 키마다 마지막(유효) 행만 남기고, 그 값에서 더 이상 없는 탭 ID를 뺀다. 탭은
 * 스프레드시트 단위라 삭제된 ID는 어느 프로필에게도 죽은 값이므로 같은 시트를 쓰는 모든
 * 프로필의 키를 함께 정리한다. 다른 설정 행(문제수 등)과 해석할 수 없는 값은 건드리지 않는다.
 */

import { batchUpdateSpreadsheet, batchUpdateValues, type DeleteRowsRequest } from "./sheets.ts";
import { SETTINGS_TAB } from "./settings.ts";

const MODES_PREFIX = "탭출제유형:";
const DISABLED_PREFIX = "탭비활성:";

export interface TabSyncPlan {
  /** 값이 바뀌는 유효 행 (1-기준 행 번호). */
  updates: { rowNumber: number; value: string }[];
  /** 지울 낡은 행 (0-기준 행 인덱스, 내림차순). */
  staleRows: number[];
  /** 유효 행에서 빠지는 죽은 탭 ID 항목 수. */
  prunedEntries: number;
}

/** 살아 있는 학습 탭 ID에 맞춰 `_정보` A:B 행의 정리 계획을 세운다. 순수 함수. */
export function planTabSync(settingsRows: string[][], liveIds: ReadonlySet<number>): TabSyncPlan {
  const lastIndex = new Map<string, number>();
  settingsRows.forEach((row, index) => {
    const key = row[0] ?? "";
    if (key.startsWith(MODES_PREFIX) || key.startsWith(DISABLED_PREFIX)) lastIndex.set(key, index);
  });

  const plan: TabSyncPlan = { updates: [], staleRows: [], prunedEntries: 0 };
  settingsRows.forEach((row, index) => {
    const key = row[0] ?? "";
    const last = lastIndex.get(key);
    if (last === undefined) return;
    if (index !== last) {
      plan.staleRows.push(index);
      return;
    }
    const pruned = pruneValue(key, row[1], liveIds);
    if (pruned && pruned.removed > 0) {
      plan.updates.push({ rowNumber: index + 1, value: pruned.value });
      plan.prunedEntries += pruned.removed;
    }
  });
  plan.staleRows.reverse();
  return plan;
}

function pruneValue(key: string, raw: string | undefined, liveIds: ReadonlySet<number>) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return null;
  }
  if (key.startsWith(DISABLED_PREFIX)) {
    if (!Array.isArray(parsed)) return null;
    const kept = parsed.filter((id) => liveIds.has(id));
    return { value: JSON.stringify(kept), removed: parsed.length - kept.length };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  const kept = entries.filter(([id]) => liveIds.has(Number(id)));
  return { value: JSON.stringify(Object.fromEntries(kept)), removed: entries.length - kept.length };
}

/** 계획을 시트에 반영한다. 값 수정을 먼저 하고(행 번호가 유효할 때) 낡은 행을 아래부터 지운다. */
export async function applyTabSync(env: Env, sheetId: string, settingsGid: number, plan: TabSyncPlan): Promise<void> {
  if (plan.updates.length > 0) {
    await batchUpdateValues(env, sheetId, SETTINGS_TAB,
      plan.updates.map(({ rowNumber, value }) => ({ range: `B${rowNumber}`, values: [[value]] })));
  }
  if (plan.staleRows.length > 0) {
    await batchUpdateSpreadsheet(env, sheetId, plan.staleRows.map((index): DeleteRowsRequest => ({
      deleteDimension: { range: { sheetId: settingsGid, dimension: "ROWS", startIndex: index, endIndex: index + 1 } },
    })));
  }
}
