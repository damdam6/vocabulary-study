/**
 * PRD §6.1: 학습 세션 큐 구성. §7.3에 따라 큐 구성은 클라이언트 책임이므로
 * 여기(src/lib)에 둔다. 상태 분류는 wordState의 getWordState를 재사용하고,
 * "시트 상 순서"는 GET /api/words가 시트 행 순서 그대로 반환하므로 입력 배열
 * 순서를 그대로 쓴다 (동률 정렬은 stable sort로 이 순서를 보존).
 */

import { getWordState, type WordProgress } from "./wordState.ts";

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

/** 셔플 분산의 "같은 단어" 식별에 tab+hanzi가 필요해 WordProgress에 추가로 요구한다. */
type QueueWord = WordProgress & { tab: string; hanzi: string };

/**
 * PRD §6.1의 세션 큐를 만든다. ① 복습 대기 전부(복습일 오래된 순 최대 60개,
 * 단어당 1문제·모드 무작위) → ② 남은 슬롯에 학습 중 단어(총 정답 수 내림차순,
 * 단어당 최대 2문제) → ③ 전체 셔플 + 같은 단어 인접 분산.
 *
 * rng는 [0,1) 난수 생성기 — 테스트에서 시드 고정용으로 주입한다.
 */
export function buildSessionQueue<T extends QueueWord>(
  words: readonly T[],
  today: string,
  rng: () => number = Math.random,
): SessionQuestion<T>[] {
  const reviewDue: T[] = [];
  const learning: T[] = [];
  for (const word of words) {
    const state = getWordState(word, today);
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
    .map((word) => ({ word, mode: randomMode(rng), isReview: true }));

  // 학습 중 단어는 정의상 m1<3 또는 m2<3이므로 단어마다 후보가 1~2개 나온다.
  const learningCandidates: SessionQuestion<T>[] = [];
  for (const word of learning.toSorted((a, b) => b.m1 + b.m2 - (a.m1 + a.m2))) {
    if (word.m1 < 3) {
      learningCandidates.push({ word, mode: "m1", isReview: false });
    }
    if (word.m2 < 3) {
      learningCandidates.push({ word, mode: "m2", isReview: false });
    }
  }

  const queue = [
    ...reviewQuestions,
    ...learningCandidates.slice(0, SESSION_CAP - reviewQuestions.length),
  ];
  shuffle(queue, rng);
  disperseAdjacentDuplicates(queue);
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

function randomMode(rng: () => number): QuizMode {
  return rng() < 0.5 ? "m1" : "m2";
}

/** Fisher–Yates 제자리 셔플. */
function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function wordKey(question: SessionQuestion<QueueWord>): string {
  return `${question.word.tab}\t${question.word.hanzi}`;
}

/**
 * 인접한 같은 단어 문제 쌍을 앞에서부터 훑으며, 새 인접 쌍을 만들지 않는 위치와
 * 교환해 분산한다. 교환 가능한 위치가 없으면 그대로 둔다 — PRD §6.1의 "가능한 한
 * 분산"이 허용하는 범위 (예: 같은 단어 2문제만 있는 큐는 분산 자체가 불가능).
 */
function disperseAdjacentDuplicates(queue: SessionQuestion<QueueWord>[]): void {
  for (let i = 1; i < queue.length; i++) {
    if (wordKey(queue[i]) !== wordKey(queue[i - 1])) {
      continue;
    }
    for (let j = 0; j < queue.length; j++) {
      if (j !== i && j !== i - 1 && trySwap(queue, i, j)) {
        break;
      }
    }
  }
}

/** i·j를 교환해 보고, 교환으로 영향받는 네 인접 쌍이 모두 무충돌이면 유지, 아니면 되돌린다. */
function trySwap(queue: SessionQuestion<QueueWord>[], i: number, j: number): boolean {
  [queue[i], queue[j]] = [queue[j], queue[i]];
  const ok =
    pairOk(queue, i - 1, i) &&
    pairOk(queue, i, i + 1) &&
    pairOk(queue, j - 1, j) &&
    pairOk(queue, j, j + 1);
  if (!ok) {
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return ok;
}

function pairOk(queue: SessionQuestion<QueueWord>[], a: number, b: number): boolean {
  return a < 0 || b >= queue.length || wordKey(queue[a]) !== wordKey(queue[b]);
}
