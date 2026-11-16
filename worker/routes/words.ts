import { readTabModesWith } from "../lib/tabModes.ts";
/**
 * GET /api/words — `_` 접두 탭을 제외한 전 탭의 단어를 하나의 배열로 통합해 반환.
 * 큐 구성·상태 판정(PRD 5.1, 6.1)은 클라이언트 책임 — 여기는 데이터 중계·정규화만 한다.
 * profile.modes는 미설정 탭 기본값이고 각 word.studyModes가 탭별 유효 모드 스냅샷이다.
 * settings 블록도 같은 패턴으로 시트 설정('_정보' 탭)을 전파한다 — 홈이 진입마다 재조회하므로
 * 시트에서 값을 고치면 다음 홈 진입에 자연히 반영된다 (PRD 7.3).
 */

import { formatSeoulDateTime } from "../lib/time.ts";
import { parseWordRow, WORD_ROW_RANGE, type WordEntry } from "../lib/words.ts";
import { toPublicProfile, type Profile } from "../lib/profiles.ts";
import { parseSettings } from "../lib/settings.ts";
import { resolveSelectedTtsConfig } from "../lib/tts/modelSelection.ts";
import { MAX_TTS_TEXT_LENGTH, type TtsCapability, type TtsWorkerEnv } from "../lib/tts/types.ts";

export async function handleGetWords(
  _request: Request,
  env: TtsWorkerEnv,
  profile: Profile,
): Promise<Response> {
  // 모델 선택(R2) 읽기는 시트 조회와 독립이라 함께 시작한다. 실패해도 단어 목록은
  // 막지 않고 발음 기능만 끈다 — TTS 설정 사고가 학습 전체 장애로 번지지 않게 한다.
  const resolvedTtsPromise = profile.contentType === "zh"
    ? resolveSelectedTtsConfig(env).catch(() => {
      console.error("[GET /api/words] tts model selection unavailable");
      return undefined;
    })
    : Promise.resolve(undefined);

  // 읽기 2회(메타데이터 + batchGet)로 고정 — 탭마다 따로 읽으면 탭 수만큼 읽기 쿼터를 쓴다.
  // '_정보' 탭도 같은 batchGet에 실려 오므로 설정(문제수)은 그 행들을 관대하게 파싱해 얻는다.
  const { tabs, settingsRows, extra: rowsByTab } = await readTabModesWith(env, profile, (names) =>
    names.map((tab) => ({ tab, range: WORD_ROW_RANGE })));
  const settings = parseSettings(settingsRows);
  const wordTabs = tabs.map((tab) => tab.name);

  const words: WordEntry[] = [];
  wordTabs.forEach((tab, i) => {
    for (const row of rowsByTab[i]) {
      words.push({ ...parseWordRow(tab, row), studyModes: tabs[i].modes });
    }
  });

  const resolvedTts = await resolvedTtsPromise;
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
