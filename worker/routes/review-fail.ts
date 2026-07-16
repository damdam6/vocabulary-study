/**
 * POST /api/review-fail — 복습 오답 시 간격만 한 단계 후퇴시킨다(기록 없음, PRD 5.3·7.3).
 * 학습 중 단어의 오답은 이 API를 호출하지 않으므로(§7.3), 여기서는 항상 이미 졸업한 단어로 가정한다.
 */

import { addDays, formatSeoulDate } from "../lib/time.ts";
import { updateValues } from "../lib/sheets.ts";
import { findWordRow } from "../lib/words.ts";
import { stepBack } from "../lib/interval.ts";

interface ReviewFailBody {
  tab?: unknown;
  hanzi?: unknown;
}

export async function handleReviewFail(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as ReviewFailBody;
  if (typeof body.tab !== "string" || typeof body.hanzi !== "string") {
    return Response.json({ error: "tab, hanzi(문자열) 필요" }, { status: 400 });
  }

  const found = await findWordRow(env, body.tab, body.hanzi);
  if (!found) {
    return new Response(null, { status: 404 });
  }

  const { rowNumber, entry } = found;
  // F열이 비어 있거나 형식이 깨진 상태(정상 흐름에서는 발생하지 않음)는 최소 간격으로 취급한다.
  const newInterval = stepBack(entry.interval ?? 1);
  const newDate = addDays(formatSeoulDate(new Date()), newInterval);

  await updateValues(env, body.tab, `F${rowNumber}:F${rowNumber}`, [[`${newDate}|${newInterval}`]]);

  return Response.json({ ...entry, nextReview: newDate, interval: newInterval });
}
