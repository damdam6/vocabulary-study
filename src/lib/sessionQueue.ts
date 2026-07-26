/**
 * PRD §6.1: 학습 세션 큐 구성. §7.3에 따라 큐 구성은 클라이언트 책임이므로
 * 여기(src/lib)에 둔다. 상태 분류는 wordState의 getWordState를 재사용하고,
 * 출제 모드도 그 활성 모드 집합 M(PRD-general §4.2) 안에서만 선택한다.
 * "시트 상 순서"는 GET /api/words가 시트 행 순서 그대로 반환하므로 입력 배열
 * 순서를 그대로 쓴다 (동률 정렬은 stable sort로 이 순서를 보존).
 */

import { getWordState, type Mode, type WordProgress } from "./wordState.ts";

/** PRD §6.1: 세션 전체 상한. §6.2의 오답 재삽입 상한도 같은 값을 쓴다(#15). */
export const SESSION_CAP = 60;

export type QuizMode = "m1" | "m2";

/** 큐의 문제 1개. mode는 POST /api/answer 요청 형식(PRD §7.3)과 동일 표기. */
export interface SessionQuestion<T> {
  word: T;
  mode: QuizMode;
  /** true면 복습 문제 — 오답 시 POST /api/review-fail 분기(§5.3)에 필요. */
  isReview: boolean;
}

/**
 * PRD-general §4.2의 세션 큐를 만든다. ① 복습 대기 전부(복습일 오래된 순 최대 60개,
 * 단어당 1문제·모드는 M 중 무작위) → ② 남은 슬롯에 학습 중 단어(총 정답 수 내림차순,
 * 단어당 1문제 — M 중 미달 모드가 하나면 그 모드, 복수면 그중 무작위, #44/#76) →
 * ③ 전체 셔플. 상태가 상호 배타라 같은 단어는 큐에 최대 한 번 들어간다. 상태 분류는
 * getWordState(word, today, modes)를 그대로 재사용한다(#75).
 *
 * modes는 활성 모드 집합 M — 복습·학습 중 모두 이 집합 안에서만 출제한다.
 * rng는 [0,1) 난수 생성기 — 테스트에서 시드 고정용으로 주입한다.
 */
export function buildSessionQueue<T extends WordProgress>(
  words: readonly T[],
  today: string,
  modes: readonly Mode[],
  rng: () => number = Math.random,
): SessionQuestion<T>[] {
  const reviewDue: T[] = [];
  const learning: T[] = [];
  for (const word of words) {
    const state = getWordState(word, today, modes);
    if (state === "reviewDue") {
      reviewDue.push(word);
    } else if (state === "learning") {
      learning.push(word);
    }
    // reviewScheduled는 출제하지 않는다 (§5.1)
  }

  const reviewQuestions: SessionQuestion<T>[] = reviewDue
    .toSorted((a, b) => compareNextReview(a.nextReview, b.nextReview))
    .slice(0, SESSION_CAP)
    .map((word) => ({ word, mode: randomMode(modes, rng), isReview: true }));

  // 학습 중 단어는 정의상 M 중 최소 한 모드가 미달 — 미달인 모드로 단어당 1문제만 낸다(#44/#76).
  const learningQuestions: SessionQuestion<T>[] = learning
    .toSorted((a, b) => b.m1 + b.m2 - (a.m1 + a.m2))
    .map((word) => ({ word, mode: learningMode(word, modes, rng), isReview: false }));

  const queue = [
    ...reviewQuestions,
    ...learningQuestions.slice(0, SESSION_CAP - reviewQuestions.length),
  ];
  shuffle(queue, rng);
  return queue;
}

/**
 * 복습일 오름차순(오래된 순) 비교. null(졸업했는데 F열이 빈 데이터 이상 상태 —
 * getWordState가 복습 대기로 취급)은 가장 오래된 것으로 취급해 60개 컷에서
 * 최우선 포함시킨다. 날짜는 YYYY-MM-DD 전제의 사전식 비교(wordState.ts와 동일).
 */
function compareNextReview(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return -1;
  }
  if (b === null) {
    return 1;
  }
  return a < b ? -1 : 1;
}

/** modes 중 무작위 하나. modes가 1개면 그 값이 항상 나온다. */
function randomMode(modes: readonly QuizMode[], rng: () => number): QuizMode {
  return modes[Math.floor(rng() * modes.length)];
}

/** 학습 중 단어의 출제 모드. M 중 미달(<3) 모드가 하나면 그 모드, 복수면 그중 무작위(#44/#76). */
function learningMode(word: WordProgress, modes: readonly QuizMode[], rng: () => number): QuizMode {
  const under = modes.filter((mode) => word[mode] < 3);
  return under.length === 1 ? under[0] : randomMode(under, rng);
}

/** Fisher–Yates 제자리 셔플. */
function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
