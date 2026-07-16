/**
 * POST /api/answer — 정답 1건 기록: 카운트 증가·졸업 판정·간격 갱신·G열 타임스탬프 append를
 * 한 요청 안에서 수행한다 (PRD 5.1, 5.3, 7.3, #8). 응답은 GET /api/words와 같은 단어 객체 형태.
 */

import { getValues, updateValues } from "../lib/sheets.ts";
import { findRowNumber, parseWordRow, type WordEntry } from "../lib/words.ts";
import {
  columnLetter,
  computeAnswerUpdate,
  findNextEmptyColumn,
  MODE_COLUMN,
  type AnswerMode,
} from "../lib/answer.ts";

interface AnswerRequest {
  tab: string;
  hanzi: string;
  mode: AnswerMode;
  timestamp: string;
  isReview: boolean;
}

function parseAnswerRequest(body: unknown): AnswerRequest | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { tab, hanzi, mode, timestamp, isReview } = body as Record<string, unknown>;
  if (typeof tab !== "string" || !tab) return null;
  if (typeof hanzi !== "string" || !hanzi) return null;
  if (mode !== "m1" && mode !== "m2") return null;
  if (typeof timestamp !== "string" || !timestamp) return null;
  if (typeof isReview !== "boolean") return null;
  return { tab, hanzi, mode, timestamp, isReview };
}

export async function handleAnswerPost(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const answer = parseAnswerRequest(body);
  if (!answer) {
    return Response.json(
      { error: "tab, hanzi, mode(m1|m2), timestamp, isReview 필드가 필요합니다" },
      { status: 400 },
    );
  }

  // 행 번호는 캐시하지 않고 매 요청마다 탭 이름 + A열 한자로 재탐색한다 (PRD 4.2).
  const rowNumber = await findRowNumber(env, answer.tab, answer.hanzi);
  if (rowNumber === null) {
    return Response.json({ error: "word not found" }, { status: 404 });
  }

  const [row = []] = await getValues(env, answer.tab, `${rowNumber}:${rowNumber}`);
  const current = parseWordRow(answer.tab, row);
  const update = computeAnswerUpdate(current, answer.mode, answer.isReview, new Date());

  const newCount = answer.mode === "m1" ? update.m1 : update.m2;
  await updateValues(env, answer.tab, `${MODE_COLUMN[answer.mode]}${rowNumber}`, [[newCount]]);

  if (update.nextReviewChanged) {
    await updateValues(env, answer.tab, `F${rowNumber}`, [[`${update.nextReview}|${update.interval}`]]);
  }

  const timestampColumn = columnLetter(findNextEmptyColumn(row));
  await updateValues(env, answer.tab, `${timestampColumn}${rowNumber}`, [
    [`${answer.timestamp}|${answer.mode}`],
  ]);

  const updated: WordEntry = {
    tab: answer.tab,
    hanzi: current.hanzi,
    pinyin: current.pinyin,
    meaning: current.meaning,
    m1: update.m1,
    m2: update.m2,
    nextReview: update.nextReview,
    interval: update.interval,
  };
  return Response.json(updated);
}
