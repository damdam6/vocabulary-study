/**
 * 단어 탭 생성 공통 로직 — POST /api/tabs(#120)와 POST /api/words/register의 createTab
 * 경로가 공유한다. 기존 단어 탭이 있으면 첫 탭의 1행 헤더를 복사하고, 0개면 contentType별
 * 기본 헤더로 첫 탭을 부트스트랩한다(#95, 등록 일반화 플랜 §3.3). 새 탭의 A1(헤더 행)에만
 * 쓴다 — 다른 셀 불가침.
 *
 * 생성은 한 번의 batchUpdate로 탭 추가 + 서식(1행 고정·헤더 색·D열 이후 기록 영역 배경)을
 * 함께 적용한다(#122). `_정보` 탭 생성(settings)은 이 서식을 받지 않는다 — sheets.ts의
 * 무서식 addSheet를 그대로 쓴다.
 */

import { batchUpdateSpreadsheet, getValues, updateValues, type RepeatCellRequest } from "./sheets.ts";
import { DEFAULT_TAB_HEADERS } from "./register.ts";
import type { ContentType } from "./profiles.ts";

interface Rgb {
  red: number;
  green: number;
  blue: number;
}

// 참조 시트 실측 서식(#122): A1·C1 노랑, B1 연두, D열부터 우측 전체 진회색(글자색은 지정 안 함).
const HEADER_YELLOW: Rgb = { red: 255 / 255, green: 217 / 255, blue: 102 / 255 }; // #FFD966
const HEADER_GREEN: Rgb = { red: 217 / 255, green: 234 / 255, blue: 211 / 255 }; // #D9EAD3
const RECORD_GRAY: Rgb = { red: 102 / 255, green: 102 / 255, blue: 102 / 255 }; // #666666

const BG_FIELDS = "userEnteredFormat.backgroundColor";

// 1행 헤더 셀 하나(column, 0-기준)에 배경색을 칠하는 repeatCell request.
function headerBackground(gid: number, column: number, color: Rgb): RepeatCellRequest {
  return {
    repeatCell: {
      range: {
        sheetId: gid,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: column,
        endColumnIndex: column + 1,
      },
      cell: { userEnteredFormat: { backgroundColor: color } },
      fields: BG_FIELDS,
    },
  };
}

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
  // 같은 배치의 서식 request가 새 탭을 참조해야 하므로 sheetId(gid)를 직접 지정한다
  // (batchUpdate 안에서는 addSheet 응답을 참조할 수 없다). 기존 탭과의 충돌 확률은
  // 탭 수/2^31로 무시 가능 — 충돌하면 batchUpdate가 400으로 실패하고 재시도로 해소된다.
  const gid = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
  await batchUpdateSpreadsheet(env, sheetId, [
    { addSheet: { properties: { sheetId: gid, title: tab, gridProperties: { frozenRowCount: 1 } } } },
    headerBackground(gid, 0, HEADER_YELLOW),
    headerBackground(gid, 1, HEADER_GREEN),
    headerBackground(gid, 2, HEADER_YELLOW),
    // 기록 영역(PRD §4.2)은 G열 이후 타임스탬프로 우측으로 계속 늘어나므로
    // 행·끝 열을 고정하지 않고 D열부터 그리드 전체를 open-ended로 칠한다.
    {
      repeatCell: {
        range: { sheetId: gid, startColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: RECORD_GRAY } },
        fields: BG_FIELDS,
      },
    },
  ]);
  await updateValues(env, sheetId, tab, "A1", [headerRow]);
}
