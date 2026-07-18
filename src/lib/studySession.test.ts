import { describe, expect, it } from "vitest";
import type { WordEntry } from "./api";
import { SESSION_CAP, type QuizMode, type SessionQuestion } from "./sessionQueue";
import {
  advance,
  applyWordUpdate,
  currentQuestion,
  isDone,
  recordAnswer,
  startSession,
  type StudySessionState,
} from "./studySession";

function makeWord(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    tab: "HSK4",
    hanzi: "经济",
    pinyin: "jīngjì",
    meaning: "경제",
    m1: 1,
    m2: 0,
    nextReview: null,
    interval: null,
    ...overrides,
  };
}

function makeQuestion(
  overrides: Partial<SessionQuestion<WordEntry>> & { word?: WordEntry } = {},
): SessionQuestion<WordEntry> {
  return { word: makeWord(), mode: "m1" as QuizMode, isReview: false, ...overrides };
}

/** 큐의 pos번째 문제까지 이동한 상태를 만든다. */
function sessionAt(questions: SessionQuestion<WordEntry>[], pos = 0): StudySessionState {
  let state = startSession(questions);
  for (let i = 0; i < pos; i++) {
    state = advance(state);
  }
  return state;
}

describe("startSession / currentQuestion / isDone", () => {
  it("모든 문제를 requeued=false로 감싸고 집계를 0에서 시작한다", () => {
    const state = startSession([makeQuestion(), makeQuestion({ mode: "m2" })]);
    expect(state.queue).toHaveLength(2);
    expect(state.queue.every((q) => q.requeued === false)).toBe(true);
    expect(state).toMatchObject({ pos: 0, correct: 0, wrong: 0 });
  });

  it("pos가 큐 길이에 도달해야 소진이고, 소진 시 현재 문제는 null", () => {
    const state = sessionAt([makeQuestion()], 0);
    expect(isDone(state)).toBe(false);
    expect(currentQuestion(state)?.word.hanzi).toBe("经济");
    const done = advance(state);
    expect(isDone(done)).toBe(true);
    expect(currentQuestion(done)).toBeNull();
  });
});

describe("recordAnswer — 네 케이스의 effect·재삽입", () => {
  it("복습 정답: answer effect(isReview=true 그대로), correct+1, 큐 불변", () => {
    const state = sessionAt([makeQuestion({ isReview: true, mode: "m2" })]);
    const { state: next, effect } = recordAnswer(state, true);
    expect(effect).toMatchObject({ kind: "answer", question: { isReview: true, mode: "m2" } });
    expect(next.correct).toBe(1);
    expect(next.wrong).toBe(0);
    expect(next.queue).toHaveLength(1);
  });

  it("복습 오답: review-fail effect, wrong+1, 재삽입 없음(재출제 금지)", () => {
    const state = sessionAt([makeQuestion({ isReview: true })]);
    const { state: next, effect } = recordAnswer(state, false);
    expect(effect).toMatchObject({ kind: "review-fail", question: { isReview: true } });
    expect(next.wrong).toBe(1);
    expect(next.queue).toHaveLength(1);
  });

  it("학습 중 정답: answer effect(isReview=false), correct+1, 큐 불변", () => {
    const state = sessionAt([makeQuestion()]);
    const { state: next, effect } = recordAnswer(state, true);
    expect(effect).toMatchObject({ kind: "answer", question: { isReview: false } });
    expect(next.correct).toBe(1);
    expect(next.queue).toHaveLength(1);
  });

  it("학습 중 오답: effect 없음, 같은 문제를 requeued=true로 큐 맨 뒤에 재삽입 — 분모 즉시 증가", () => {
    const questions = [makeQuestion({ mode: "m2" }), makeQuestion({ word: makeWord({ hanzi: "严重" }) })];
    const state = sessionAt(questions);
    const { state: next, effect } = recordAnswer(state, false);
    expect(effect).toEqual({ kind: "none" });
    expect(next.wrong).toBe(1);
    expect(next.queue).toHaveLength(3);
    expect(next.queue[2]).toMatchObject({
      word: { hanzi: "经济" },
      mode: "m2",
      isReview: false,
      requeued: true,
    });
  });

  it("재삽입 복사본이 다시 오답이어도 재재삽입하지 않는다(1회만)", () => {
    let state = sessionAt([makeQuestion()]);
    state = recordAnswer(state, false).state; // 원본 오답 → 재삽입, 길이 2
    state = advance(state); // 재삽입 복사본으로 이동
    expect(currentQuestion(state)?.requeued).toBe(true);
    const { state: next, effect } = recordAnswer(state, false);
    expect(effect).toEqual({ kind: "none" });
    expect(next.queue).toHaveLength(2);
    expect(next.wrong).toBe(2);
  });

  it("큐가 SESSION_CAP이면 학습 중 오답이라도 재삽입하지 않는다", () => {
    const questions = Array.from({ length: SESSION_CAP }, (_, i) =>
      makeQuestion({ word: makeWord({ hanzi: `词${i}` }) }),
    );
    const state = sessionAt(questions);
    const { state: next } = recordAnswer(state, false);
    expect(next.queue).toHaveLength(SESSION_CAP);
    expect(next.wrong).toBe(1);
  });
});

describe("세션 흐름 집계", () => {
  it("정오가 섞인 세션의 correct/wrong 합계가 완료 화면 수치와 일치한다", () => {
    // 학습 중 3문제: 정답 → 오답(재삽입) → 정답 → 재삽입 복사본 정답
    let state = sessionAt([
      makeQuestion(),
      makeQuestion({ word: makeWord({ hanzi: "严重" }) }),
      makeQuestion({ word: makeWord({ hanzi: "环境" }), mode: "m2" }),
    ]);
    state = advance(recordAnswer(state, true).state);
    state = advance(recordAnswer(state, false).state);
    state = advance(recordAnswer(state, true).state);
    expect(state.queue).toHaveLength(4); // 오답 1건 재삽입
    expect(isDone(state)).toBe(false);
    state = advance(recordAnswer(state, true).state);
    expect(isDone(state)).toBe(true);
    expect(state.correct).toBe(3);
    expect(state.wrong).toBe(1);
  });
});

describe("applyWordUpdate", () => {
  it("같은 tab+hanzi의 큐 항목 스냅샷만 갱신한다", () => {
    const shared = makeWord();
    const state = sessionAt([
      makeQuestion({ word: shared }),
      makeQuestion({ word: shared, mode: "m2" }),
      makeQuestion({ word: makeWord({ hanzi: "严重", m1: 2 }) }),
    ]);
    const updated = makeWord({ m1: 2, nextReview: "2026-07-19", interval: 1 });
    const next = applyWordUpdate(state, updated);
    expect(next.queue[0].word).toEqual(updated);
    expect(next.queue[1].word).toEqual(updated);
    expect(next.queue[2].word.m1).toBe(2);
    expect(next.queue[2].word.hanzi).toBe("严重");
  });

  it("다른 탭의 동일 한자는 갱신하지 않는다", () => {
    const state = sessionAt([makeQuestion({ word: makeWord({ tab: "HSK5" }) })]);
    const next = applyWordUpdate(state, makeWord({ m1: 3 }));
    expect(next.queue[0].word.m1).toBe(1);
  });
});
