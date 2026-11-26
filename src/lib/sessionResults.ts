/**
 * 세션 결과 화면(design-prd §5)의 순수 계산 — 화면(DoneScreen)과 이미지 저장
 * (resultImage.ts)이 같은 순서·같은 수치를 쓰도록 한곳에 둔다. DOM·canvas 없이
 * vitest(node)로 고정한다.
 */

import type { QuestionResult } from "./studySession.ts";

/** 출제 순서(1부터)를 붙인 결과 — 화면에는 표시하지 않고 목록 key로만 쓴다. */
export interface NumberedResult extends QuestionResult {
  num: number;
}

export interface ResultSummary {
  total: number;
  correct: number;
  wrong: number;
  /** 정답률(%) — 반올림한 정수. 문제가 없으면 0. */
  rate: number;
  /** 틀린 문제를 출제 순서대로. */
  wrongItems: NumberedResult[];
  /** 맞힌 문제를 출제 순서대로. */
  correctItems: NumberedResult[];
}

export function summarizeResults(results: readonly QuestionResult[]): ResultSummary {
  const numbered = results.map((result, index) => ({ ...result, num: index + 1 }));
  const wrongItems = numbered.filter((item) => !item.correct);
  const correctItems = numbered.filter((item) => item.correct);
  const total = numbered.length;
  return {
    total,
    correct: correctItems.length,
    wrong: wrongItems.length,
    rate: total === 0 ? 0 : Math.round((correctItems.length / total) * 100),
    wrongItems,
    correctItems,
  };
}

/** 저장 이미지 한 장에 담는 문제 수 — 넘으면 여러 장으로 나눈다(canvas 크기 한계). */
export const ITEMS_PER_IMAGE = 120;

/** 이미지 한 장 안의 한 구간. continued면 앞 장에서 이어지는 구간이다. */
export interface ResultPageBlock {
  kind: "wrong" | "correct";
  continued: boolean;
  items: NumberedResult[];
}

export interface ResultPage {
  /** 1부터. */
  page: number;
  pageCount: number;
  blocks: ResultPageBlock[];
}

/**
 * 틀린 문제 → 맞힌 문제를 이어 붙인 순서 그대로 perPage개씩 자른다. 문제가 없어도 요약을
 * 담을 한 장은 만든다.
 */
export function paginateResults(summary: ResultSummary, perPage: number = ITEMS_PER_IMAGE): ResultPage[] {
  const ordered = [
    ...summary.wrongItems.map((item) => ({ kind: "wrong" as const, item })),
    ...summary.correctItems.map((item) => ({ kind: "correct" as const, item })),
  ];
  const pageCount = Math.max(1, Math.ceil(ordered.length / perPage));
  const pages: ResultPage[] = [];
  for (let index = 0; index < pageCount; index++) {
    const blocks: ResultPageBlock[] = [];
    ordered.slice(index * perPage, (index + 1) * perPage).forEach(({ kind, item }, offset) => {
      const last = blocks[blocks.length - 1];
      if (last?.kind === kind) {
        last.items.push(item);
        return;
      }
      const previous = ordered[index * perPage + offset - 1];
      blocks.push({ kind, continued: offset === 0 && previous?.kind === kind, items: [item] });
    });
    pages.push({ page: index + 1, pageCount, blocks });
  }
  return pages;
}

/**
 * "내 답"으로 보여 줄 값. 모드2 오답에서 실제로 입력한 경우만 — 학습 화면(Mode2Card)과
 * 같은 규칙으로 공백만 입력한 답은 보이지 않는다. 표시는 앞뒤 공백만 걷어낸 원입력.
 */
export function visibleAnswer(result: QuestionResult): string | null {
  if (result.correct || result.mode !== "m2" || result.answer === undefined) return null;
  const trimmed = result.answer.trim();
  return trimmed === "" ? null : trimmed;
}

const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/u;
/** 줄 첫머리에 오면 안 되는 닫는 문장부호 — 앞 글자에 붙여 함께 넘긴다. */
const NO_LINE_START = new Set(Array.from("。，、．！？；：）」』】》〉”’…,.!?;:)]}"));

/**
 * 줄바꿈 단위로 쪼갠다. 공백 뒤와 한·중·일 문자 앞뒤에서 끊을 수 있다 — 띄어쓰기가 없는
 * 중국어 문장도, 띄어쓰기가 있는 한국어·영어 뜻도 자연스럽게 감긴다.
 */
function breakTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of Array.from(text)) {
    if (NO_LINE_START.has(char) && current === "" && tokens.length > 0 && !tokens[tokens.length - 1].endsWith(" ")) {
      tokens[tokens.length - 1] += char;
    } else if (CJK.test(char)) {
      if (current !== "") tokens.push(current);
      tokens.push(char);
      current = "";
    } else if (char === " ") {
      tokens.push(current + char);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

/**
 * canvas 텍스트 줄바꿈. measure는 현재 폰트 기준 폭(px)을 돌려준다. 한 토큰이 maxWidth보다
 * 길면 글자 단위로 끊는다. 줄 끝 공백은 지운다. 빈 문자열은 빈 배열.
 */
export function wrapText(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  const pushLine = () => {
    const trimmed = line.trimEnd();
    if (trimmed !== "") lines.push(trimmed);
    line = "";
  };
  for (const token of breakTokens(text.replace(/\s+/g, " ").trim())) {
    if (measure((line + token).trimEnd()) <= maxWidth) {
      line += token;
      continue;
    }
    if (line !== "") pushLine();
    if (measure(token.trimEnd()) <= maxWidth) {
      line = token;
      continue;
    }
    for (const char of Array.from(token)) {
      if (line !== "" && measure((line + char).trimEnd()) > maxWidth) pushLine();
      line += char;
    }
  }
  pushLine();
  return lines;
}

const fileStampFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 저장 파일 이름 — Asia/Seoul 기준 `session-result-YYYYMMDD-HHmm.png`. 여러 장이면
 * `-1`, `-2`처럼 장 번호를 붙인다.
 */
export function resultImageFileName(date: Date, page = 1, pageCount = 1): string {
  const parts = Object.fromEntries(fileStampFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  const suffix = pageCount > 1 ? `-${page}` : "";
  return `session-result-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${suffix}.png`;
}

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "numeric",
  minute: "2-digit",
});

/** 이미지 하단의 완료 시각 — `오후 9:42` 형식, Asia/Seoul 기준. */
export function formatResultTime(date: Date): string {
  return timeFormatter.format(date);
}
