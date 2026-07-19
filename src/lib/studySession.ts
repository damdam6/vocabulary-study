/**
 * PRD §6.2·design-prd §4.5: 학습 세션 진행 규칙 — 정오 판정에 따른 기록 effect
 * 결정, 학습 중 오답 재삽입, 정오 집계. 화면(StudyScreen)이 아닌 순수 모듈에 두는
 * 이유: 네 케이스(복습/학습 중 × 정오)의 API 분기와 재삽입·분모 규칙이 #15의 검증
 * 대상이라 vitest(node 환경)로 고정한다 — wordState·sessionQueue와 같은 배치.
 */

import type { WordEntry } from "./api.ts";
import { SESSION_CAP, type SessionQuestion } from "./sessionQueue.ts";

/** 진행 중 큐 항목. requeued는 학습 중 오답 재삽입 복사본 표시 — 재재삽입(§6.2 "1회만")을 막는다. */
export interface StudyQuestion extends SessionQuestion<WordEntry> {
  requeued: boolean;
}

export interface StudySessionState {
  /** 학습 중 오답 재삽입으로 세션 도중 늘어날 수 있다 — 진행도 분모는 항상 queue.length. */
  queue: StudyQuestion[];
  /** 현재 문제 인덱스. queue.length에 도달하면 세션 소진. */
  pos: number;
  correct: number;
  wrong: number;
}

/** 판정 직후 셸이 발사해야 할 기록 API. none = 학습 중 오답(호출 없음, §6.2). */
export type RecordEffect =
  | { kind: "answer"; question: StudyQuestion }
  | { kind: "review-fail"; question: StudyQuestion }
  | { kind: "none" };

/**
 * PRD §5.2 모드 2 채점: 트림한 입력이 A열 한자와 정확 일치해야만 정답 — 병음
 * 입력·부분 일치·이체자는 모두 오답, 빈 입력도 오답. 트림된 입력을 함께 돌려주는
 * 것은 오답 결과 화면의 "내 답" 표시(§4.3)가 같은 값을 쓰기 때문.
 */
export function gradeMode2(input: string, hanzi: string): { correct: boolean; answer: string } {
  const answer = input.trim();
  return { correct: answer !== "" && answer === hanzi, answer };
}

export function startSession(questions: readonly SessionQuestion<WordEntry>[]): StudySessionState {
  return {
    queue: questions.map((question) => ({ ...question, requeued: false })),
    pos: 0,
    correct: 0,
    wrong: 0,
  };
}

export function currentQuestion(state: StudySessionState): StudyQuestion | null {
  return state.queue[state.pos] ?? null;
}

export function isDone(state: StudySessionState): boolean {
  return state.pos >= state.queue.length;
}

/**
 * 정오 판정을 집계·큐에 반영하고, 셸이 발사할 기록 effect를 알려준다. 진행(advance)을
 * 분리한 것은 모드2 오답이 결과 화면 동안 현재 문제에 머물러야 하기 때문(§4.5).
 * effect에 타임스탬프가 없는 것은 의도 — 시각은 발사 시점에 셸이 만든다(모듈 순수성).
 */
export function recordAnswer(
  state: StudySessionState,
  isCorrect: boolean,
): { state: StudySessionState; effect: RecordEffect } {
  const question = state.queue[state.pos];
  if (isCorrect) {
    return {
      state: { ...state, correct: state.correct + 1 },
      effect: { kind: "answer", question },
    };
  }
  if (question.isReview) {
    // 복습 오답: 간격 후퇴만(§5.3). 복습 문제는 단어당 1개(§6.1)라 재삽입하지 않는
    // 것만으로 "이번 세션 재출제 없음"이 성립한다.
    return {
      state: { ...state, wrong: state.wrong + 1 },
      effect: { kind: "review-fail", question },
    };
  }
  // 학습 중 오답: API 호출 없음. 원본 문제일 때만 큐 맨 뒤에 1회 재삽입(60문제 상한 내)
  // — 진행도 분모가 이 시점에 즉시 늘어난다.
  const queue =
    !question.requeued && state.queue.length < SESSION_CAP
      ? [...state.queue, { ...question, requeued: true }]
      : state.queue;
  return {
    state: { ...state, queue, wrong: state.wrong + 1 },
    effect: { kind: "none" },
  };
}

/** 다음 문제로 이동. 소진 여부는 isDone으로 판정한다. */
export function advance(state: StudySessionState): StudySessionState {
  return { ...state, pos: state.pos + 1 };
}

/**
 * POST /api/answer 응답의 갱신 단어를 같은 단어(tab+hanzi)의 큐 항목 스냅샷에
 * 반영한다. 셸 화면에 보이는 값은 아니지만 이후 문제가 서버 상태와 같은 데이터를
 * 보도록 정합을 지킨다. 지나간 항목까지 갱신해도 무해해서 위치를 가리지 않는다.
 */
export function applyWordUpdate(state: StudySessionState, word: WordEntry): StudySessionState {
  return {
    ...state,
    queue: state.queue.map((question) =>
      question.word.tab === word.tab && question.word.hanzi === word.hanzi
        ? { ...question, word }
        : question,
    ),
  };
}
