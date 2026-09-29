import { readTabModes } from "../lib/tabModes.ts";
/**
 * GET /api/words — `_` 접두 탭을 제외한 전 탭의 단어를 하나의 배열로 통합해 반환.
 * 큐 구성·상태 판정(PRD 5.1, 6.1)은 클라이언트 책임 — 여기는 데이터 중계·정규화만 한다.
 * profile.modes는 미설정 탭 기본값이고 각 word.studyModes가 탭별 유효 모드 스냅샷이다.
 * settings 블록도 같은 패턴으로 시트 설정('_정보' 탭)을 전파한다 — 홈이 진입마다 재조회하므로
 * 시트에서 값을 고치면 다음 홈 진입에 자연히 반영된다 (PRD 7.3).
 */

import { formatSeoulDateTime } from "../lib/time.ts";
import { getValues } from "../lib/sheets.ts";
import { parseWordRow, WORD_ROW_RANGE, type WordEntry } from "../lib/words.ts";
import { toPublicProfile, type Profile } from "../lib/profiles.ts";
import { readSettings } from "../lib/settings.ts";
import { resolveTtsConfig } from "../lib/tts/config.ts";
import { MAX_TTS_TEXT_LENGTH, type TtsCapability, type TtsWorkerEnv } from "../lib/tts/types.ts";

export async function handleGetWords(
  _request: Request,
  env: TtsWorkerEnv,
  profile: Profile,
): Promise<Response> {
  // 설정 읽기는 단어 조회와 독립이므로 병렬로 — 시트 왕복이 직렬로 늘지 않는다.
  const [{ tabs }, settings] = await Promise.all([
    readTabModes(env, profile),
    readSettings(env, profile.sheetId),
  ]);

  const wordTabs = tabs.map((tab) => tab.name);
  const rowsByTab = await Promise.all(
    wordTabs.map((tab) => getValues(env, profile.sheetId, tab, WORD_ROW_RANGE)),
  );

  const words: WordEntry[] = [];
  wordTabs.forEach((tab, i) => {
    for (const row of rowsByTab[i]) {
      words.push({ ...parseWordRow(tab, row), studyModes: tabs[i].modes });
    }
  });

  const resolvedTts = profile.contentType === "zh" ? resolveTtsConfig(env) : undefined;
  const tts: TtsCapability = resolvedTts?.status === "ready"
    ? { enabled: true, revision: resolvedTts.config.revision, maxTextLength: MAX_TTS_TEXT_LENGTH }
    : { enabled: false };

  return Response.json({
    fetchedAt: formatSeoulDateTime(new Date()),
    words,
    profile: toPublicProfile(profile),
    settings,
    tts,
  });
}
