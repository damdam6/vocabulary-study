/**
 * POST /api/words/register — 단어 등록 시스템 플랜(`docs/plans/word-registration-system.md`) §6,
 * 3단계(저장). 클라이언트가 보낸 단어 배열을 인증 프로필의 contentType으로 재검증하고
 * (등록 일반화 플랜 `docs/plans/registration-generalization.md` §3.2·§3.3), 탭 내 중복 A열 값은
 * 스킵, 신규 단어만 마지막 데이터 행 아래 A·B·C열에 append-only로 기록한다(D열 이후 절대 불가침).
 * createTab이면 새 탭을 생성한다(lib/tabs.ts 공통 로직 — 헤더 복사/기본 헤더 부트스트랩 §3.3).
 * 탭 생성의 주 경로는 POST /api/tabs(#120, 등록 화면 "생성" 버튼)로 옮겨졌고 클라이언트는
 * 더 이상 createTab을 보내지 않는다 — 이 경로는 계약 호환으로만 유지한다.
 */

import { getValues, updateValues } from "../lib/sheets.ts";
import { createWordTab } from "../lib/tabs.ts";
import { getWordTabTitles } from "../lib/words.ts";
import { MAX_REGISTER_WORDS, normalizeTabName, parseRegisterWords, partitionByExisting } from "../lib/register.ts";
import type { Profile } from "../lib/profiles.ts";

export async function handleWordsRegister(
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
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "tab, words[] 필드가 필요합니다" }, { status: 400 });
  }

  const { tab: rawTab, createTab, words: rawWords } = body as Record<string, unknown>;
  if (createTab !== undefined && typeof createTab !== "boolean") {
    return Response.json({ error: "createTab은 boolean이어야 합니다" }, { status: 400 });
  }

  const tabResult = normalizeTabName(rawTab);
  if ("error" in tabResult) {
    return Response.json({ error: tabResult.error }, { status: 400 });
  }

  const words = parseRegisterWords(rawWords, profile.contentType);
  if (!words) {
    // 400 문구는 contentType별로 정확하게 — zh 문구는 현행 그대로 유지한다(§3.3).
    const error =
      profile.contentType === "generic"
        ? "words[]는 hanzi(표제어)/pinyin(보조 표기)/meaning(뜻) 필드가 필요합니다 — " +
          "표제어·뜻은 공백 아닌 문자열, 보조 표기는 문자열(빈칸 허용), 배열 내 표제어 중복 금지이며 " +
          `최대 ${MAX_REGISTER_WORDS}건까지 등록할 수 있습니다`
        : "words[]는 hanzi/pinyin/meaning(공백 아닌 문자열, 배열 내 한자 중복 금지), " +
          "한자는 유니코드 U+4E00–U+9FFF, 병음은 성조 부호 필수(숫자 표기 금지)여야 하며 " +
          `최대 ${MAX_REGISTER_WORDS}건까지 등록할 수 있습니다`;
    return Response.json({ error }, { status: 400 });
  }

  const wordTabs = await getWordTabTitles(env, profile.sheetId);
  const targetTab = tabResult.name;
  let created = false;

  if (!wordTabs.includes(targetTab)) {
    if (!createTab) {
      return Response.json(
        { error: "존재하지 않는 탭입니다. 새로 만들려면 createTab을 지정하세요" },
        { status: 400 },
      );
    }
    await createWordTab(env, profile.sheetId, targetTab, wordTabs, profile.contentType);
    created = true;
  }

  // 행 번호를 캐시하지 않고 매 요청 재탐색한다(PRD 4.2) — 이미 중복 검사용으로 읽은 A2:A 결과를
  // 그대로 다음 빈 행 계산에 재사용해 A·B·C열에만 명시적 range로 쓴다(D열 이후 불가침).
  const existingRows = await getValues(env, profile.sheetId, targetTab, "A2:A");
  const existingHanzi = existingRows.map((row) => row[0]).filter((v): v is string => !!v);

  const { toAdd, skipped } = partitionByExisting(words, existingHanzi);

  if (toAdd.length > 0) {
    const nextRow = existingRows.length + 2;
    const lastRow = nextRow + toAdd.length - 1;
    const values = toAdd.map((w) => [w.hanzi, w.pinyin, w.meaning]);
    await updateValues(env, profile.sheetId, targetTab, `A${nextRow}:C${lastRow}`, values);
  }

  return Response.json({ tab: targetTab, created, added: toAdd, skipped });
}
