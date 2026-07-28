/**
 * GET /api/tabs — 학습 대상 탭 목록(`_` 접두 제외). 등록 화면의 탭 선택 드롭다운이 사용한다(플랜 §6).
 * POST /api/tabs — 단어 탭 생성(#120). 등록 화면 "생성" 버튼이 클릭 시점에 호출한다 — 트림 후
 * 기존 탭과 같으면 생성 없이 성공(멱등, created: false — 그 탭을 선택하라는 의미), 새 이름이면
 * lib/tabs.ts 공통 로직으로 생성(헤더 복사/기본 헤더 부트스트랩). 이름 규칙은 등록과 같은
 * normalizeTabName이 단일 원본이다.
 */

import { getWordTabTitles } from "../lib/words.ts";
import { createWordTab } from "../lib/tabs.ts";
import { normalizeTabName } from "../lib/register.ts";
import type { Profile } from "../lib/profiles.ts";

export async function handleGetTabs(_request: Request, env: Env, profile: Profile): Promise<Response> {
  const tabs = await getWordTabTitles(env, profile.sheetId);
  return Response.json({ tabs });
}

export async function handleCreateTab(request: Request, env: Env, profile: Profile): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "name 필드가 필요합니다" }, { status: 400 });
  }

  const nameResult = normalizeTabName((body as Record<string, unknown>).name);
  if ("error" in nameResult) {
    return Response.json({ error: nameResult.error }, { status: 400 });
  }
  const name = nameResult.name;

  const wordTabs = await getWordTabTitles(env, profile.sheetId);
  if (wordTabs.includes(name)) {
    return Response.json({ name, created: false });
  }
  await createWordTab(env, profile.sheetId, name, wordTabs, profile.contentType);
  return Response.json({ name, created: true });
}
