/** GET /api/tabs — 학습 대상 탭 목록(`_` 접두 제외). 등록 화면의 탭 선택 드롭다운이 사용한다(플랜 §6). */

import { getWordTabTitles } from "../lib/words.ts";
import type { Profile } from "../lib/profiles.ts";

export async function handleGetTabs(_request: Request, env: Env, profile: Profile): Promise<Response> {
  const tabs = await getWordTabTitles(env, profile.sheetId);
  return Response.json({ tabs });
}
