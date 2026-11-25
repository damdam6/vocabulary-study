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

/**
 * "내 답"으로 보여 줄 값. 모드2 오답에서 실제로 입력한 경우만 — 학습 화면(Mode2Card)과
 * 같은 규칙으로 공백만 입력한 답은 보이지 않는다. 표시는 앞뒤 공백만 걷어낸 원입력.
 */
export function visibleAnswer(result: QuestionResult): string | null {
  if (result.correct || result.mode !== "m2" || result.answer === undefined) return null;
  const trimmed = result.answer.trim();
  return trimmed === "" ? null : trimmed;
}

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/u;

/**
 * 줄바꿈 단위로 쪼갠다. 공백 뒤와 한·중·일 문자 앞뒤에서 끊을 수 있다 — 띄어쓰기가 없는
 * 중국어 문장도, 띄어쓰기가 있는 한국어·영어 뜻도 자연스럽게 감긴다.
 */
function breakTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of Array.from(text)) {
    if (CJK.test(char)) {
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

/** 저장 파일 이름 — Asia/Seoul 기준 `session-result-YYYYMMDD-HHmm.png`. */
export function resultImageFileName(date: Date): string {
  const parts = Object.fromEntries(fileStampFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `session-result-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}.png`;
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
