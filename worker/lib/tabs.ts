/**
 * 단어 탭 생성 공통 로직 — POST /api/tabs(#120)와 POST /api/words/register의 createTab
 * 경로가 공유한다. 기존 단어 탭이 있으면 첫 탭의 1행 헤더를 복사하고, 0개면 contentType별
 * 기본 헤더로 첫 탭을 부트스트랩한다(#95, 등록 일반화 플랜 §3.3). 새 탭의 A1(헤더 행)에만
 * 쓴다 — 다른 셀 불가침.
 */

import { addSheet, getValues, updateValues } from "./sheets.ts";
import { DEFAULT_TAB_HEADERS } from "./register.ts";
import type { ContentType } from "./profiles.ts";

/** 새 단어 탭을 만들고 1행 헤더를 채운다. 호출 전에 tab이 wordTabs에 없음을 확인해야 한다. */
export async function createWordTab(
  env: Env,
  sheetId: string,
  tab: string,
  wordTabs: string[],
  contentType: ContentType,
): Promise<void> {
  const headerRow =
    wordTabs.length === 0
      ? DEFAULT_TAB_HEADERS[contentType]
      : ((await getValues(env, sheetId, wordTabs[0], "1:1"))[0] ?? []);
  await addSheet(env, sheetId, tab);
  await updateValues(env, sheetId, tab, "A1", [headerRow]);
}
