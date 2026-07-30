/**
 * PRD §6.1: 학습 세션 큐 구성. §7.3에 따라 큐 구성은 클라이언트 책임이므로
 * 여기(src/lib)에 둔다. 상태 분류는 wordState의 getWordState를 재사용하고,
 * 출제 모드도 그 활성 모드 집합 M(PRD-general §4.2) 안에서만 선택한다.
 * "시트 상 순서"는 GET /api/words가 시트 행 순서 그대로 반환하므로 입력 배열
 * 순서를 그대로 쓴다 (동률 정렬은 stable sort로 이 순서를 보존).
 */

import { getWordState, type Mode, type WordProgress } from "./wordState.ts";

/** PRD §6.1: 세션 전체 상한의 기본값 — 시트 `문제수` 설정이 없을 때 쓰인다(#102). */
export const SESSION_CAP = 60;

/**
 * PRD §6.1: 복습 대기가 세션 상한을 통째로 가져가지 못하게 하는 몫 비율(#128).
 * 복습만으로 상한이 차면 학습 슬롯이 0이 되어 신규 단어가 아예 못 들어온다.
 * 추후 조정할 수 있도록 상수로 둔다.
 */
export const REVIEW_SHARE = 0.3;

export type QuizMode = "m1" | "m2";

/** 세션 상한을 복습/학습에 나눈 결과. total은 큐 길이이자 홈의 "오늘 세션 · n문제"다. */
export interface SessionSlots {
  review: number;
  learning: number;
  total: number;
}

/**
 * PRD §6.1: 세션 상한 limit을 복습 대기·학습 중에 배분한다(#128). 개수만 받는 순수
 * 함수라 큐 구성(buildSessionQueue)과 홈 집계(computeHomeStats)가 같은 산식을 공유한다
 * — 종전처럼 산식을 양쪽에 각각 적어두면 한쪽만 고쳤을 때 홈 표시와 실제 큐 길이가
 * 어긋난다(HomeScreen.tsx의 "같은 산식이라 빈 큐가 나올 수 없다" 불변식).
 *
 * total은 이 배분을 넣기 전 산식 min(limit, min(복습대기, limit) + 학습중)과 항상 같다
 * — 몫 상한은 복습/학습의 "비율"만 바꾸고 총 문제 수는 건드리지 않는다.
 */
export function splitSessionSlots(reviewDue: number, learning: number, limit: number): SessionSlots {
  // 복습 몫은 상한의 REVIEW_SHARE. 복습 대기가 있으면 최소 1문제는 확보한다 —
  // limit ≤ 3이면 floor가 0이 되어 복습이 완전히 굶는다(§12 "복습 누락 방지가 우선").
  const quota = Math.max(1, Math.floor(limit * REVIEW_SHARE));
  // 학습은 복습 몫을 뺀 나머지를 쓴다. 복습 대기가 몫보다 적으면 그만큼만 예약된다.
  const learningTake = Math.min(learning, limit - Math.min(reviewDue, quota));
  // 학습이 남긴 슬롯은 복습이 회수한다 — 몫은 하한 보장이지 낭비를 강요하는 상한이 아니다.
  const reviewTake = Math.min(reviewDue, limit - learningTake);
  return { review: reviewTake, learning: learningTake, total: reviewTake + learningTake };
}

/** 큐의 문제 1개. mode는 POST /api/answer 요청 형식(PRD §7.3)과 동일 표기. */
export interface SessionQuestion<T> {
  word: T;
  mode: QuizMode;
  /** true면 복습 문제 — 오답 시 POST /api/review-fail 분기(§5.3)에 필요. */
  isReview: boolean;
}

/**
 * PRD-general §4.2의 세션 큐를 만든다. ① splitSessionSlots로 상한을 복습/학습에 배분 →
 * ② 복습 대기를 복습일 오래된 순으로 그 몫만큼(단어당 1문제·모드는 M 중 무작위) →
 * ③ 남은 슬롯에 학습 중 단어를 총 정답 수 오름차순으로(단어당 1문제 — M 중 미달 모드가
 * 하나면 그 모드, 복수면 그중 무작위, #44/#76) → ④ 전체 셔플. 상태가 상호 배타라 같은
 * 단어는 큐에 최대 한 번 들어간다. 상태 분류는 getWordState(word, today, modes)를 그대로
 * 재사용한다(#75).
 *
 * 학습 중 정렬이 오름차순인 이유(#128): 내림차순이면 D=E=0인 신규 단어가 항상 최하위로
 * 밀려, 학습 중 단어가 상한보다 많은 시트에서는 기존 단어가 졸업할 때까지 영구히 출제되지
 * 않았다. 오름차순은 등록 즉시 다음 세션에 나오게 하고, 학습 중 오답은 기록 API를 쏘지
 * 않아 점수가 그대로이므로(§6.2) 못 맞히는 단어가 계속 앞에 남는 효과도 같이 온다.
 *
 * modes는 활성 모드 집합 M — 복습·학습 중 모두 이 집합 안에서만 출제한다.
 * rng는 [0,1) 난수 생성기 — 테스트에서 시드 고정용으로 주입한다.
 * limit은 세션 총 상한인 시트별 세션 문제 수(세션 설정 플랜 §3.2) — 복습/학습 컷은
 * 여기서 splitSessionSlots가 파생한다. 기본값은 SESSION_CAP(60)이다.
 */
export function buildSessionQueue<T extends WordProgress>(
  words: readonly T[],
  today: string,
  modes: readonly Mode[],
  rng: () => number = Math.random,
  limit: number = SESSION_CAP,
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

  const slots = splitSessionSlots(reviewDue.length, learning.length, limit);

  // slice를 map보다 앞에 둔다 — 탈락할 단어까지 모드를 뽑으면 rng만 헛돈다.
  const reviewQuestions: SessionQuestion<T>[] = reviewDue
    .toSorted((a, b) => compareNextReview(a.nextReview, b.nextReview))
    .slice(0, slots.review)
    .map((word) => ({ word, mode: randomMode(modes, rng), isReview: true }));

  // 학습 중 단어는 정의상 M 중 최소 한 모드가 미달 — 미달인 모드로 단어당 1문제만 낸다(#44/#76).
  const learningQuestions: SessionQuestion<T>[] = learning
    .toSorted((a, b) => a.m1 + a.m2 - (b.m1 + b.m2))
    .slice(0, slots.learning)
    .map((word) => ({ word, mode: learningMode(word, modes, rng), isReview: false }));

  const queue = [...reviewQuestions, ...learningQuestions];
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
