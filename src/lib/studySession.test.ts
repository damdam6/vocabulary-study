import { describe, expect, it } from "vitest";
import type { WordEntry } from "./api";
import type { QuizMode, SessionQuestion } from "./sessionQueue";
import {
  advance,
  applyWordUpdate,
  currentQuestion,
  gradeMode2,
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

describe("gradeMode2 — PRD §5.2 채점 규칙", () => {
  it("정확 일치는 정답", () => {
    expect(gradeMode2("经济", "经济")).toEqual({ correct: true, answer: "经济" });
  });

  it("앞뒤 공백은 트림 후 판정하고 트림된 내 답을 돌려준다", () => {
    expect(gradeMode2("  经济 ", "经济")).toEqual({ correct: true, answer: "经济" });
  });

  it("빈 입력·공백만 입력은 오답", () => {
    expect(gradeMode2("", "经济")).toEqual({ correct: false, answer: "" });
    expect(gradeMode2("   ", "经济")).toEqual({ correct: false, answer: "" });
  });

  it("병음 입력은 오답", () => {
    expect(gradeMode2("jīngjì", "经济").correct).toBe(false);
  });

  it("부분 일치는 오답", () => {
    expect(gradeMode2("经", "经济").correct).toBe(false);
  });

  it("이체자(번체) 입력은 오답 — A열 표기와 자소까지 같아야 한다", () => {
    expect(gradeMode2("經濟", "经济").correct).toBe(false);
  });
});

describe("startSession / currentQuestion / isDone", () => {
  it("받은 큐를 그대로 세션 큐로 삼고 집계를 0에서 시작한다", () => {
    const questions = [makeQuestion(), makeQuestion({ mode: "m2" })];
    const state = startSession(questions);
    expect(state.queue).toEqual(questions);
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

describe("recordAnswer — 네 케이스의 effect·큐 불변", () => {
  it("복습 정답: answer effect(isReview=true 그대로), correct+1, 큐 불변", () => {
    const state = sessionAt([makeQuestion({ isReview: true, mode: "m2" })]);
    const { state: next, effect } = recordAnswer(state, true);
    expect(effect).toMatchObject({ kind: "answer", question: { isReview: true, mode: "m2" } });
    expect(next.correct).toBe(1);
    expect(next.wrong).toBe(0);
    expect(next.queue).toHaveLength(1);
  });

  it("복습 오답: review-fail effect, wrong+1, 세션 내 재출제 없음", () => {
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

  it("학습 중 오답: effect 없음, wrong+1, 큐는 내용까지 그대로 — 같은 세션 재출제 없음", () => {
    const questions = [makeQuestion({ mode: "m2" }), makeQuestion({ word: makeWord({ hanzi: "严重" }) })];
    const state = sessionAt(questions);
    const { state: next, effect } = recordAnswer(state, false);
    expect(effect).toEqual({ kind: "none" });
    expect(next.wrong).toBe(1);
    expect(next.queue).toEqual(questions);
  });

  it("모드1 학습 중 오답도 큐에 그 단어를 다시 넣지 않는다", () => {
    const state = sessionAt([makeQuestion({ mode: "m1" }), makeQuestion({ word: makeWord({ hanzi: "严重" }) })]);
    const { state: next } = recordAnswer(state, false);
    expect(next.queue.filter((q) => q.word.hanzi === "经济")).toHaveLength(1);
  });
});

/**
 * #116: 재삽입 규칙 제거의 핵심 계약 — 세션 큐는 시작 시 확정된다. 진행도 분모가
 * 곧 queue.length라, 분모가 세션 중 변하면 사용자에게 그대로 보인다.
 */
describe("recordAnswer — 세션 큐·진행도 분모 불변", () => {
  /** 학습 중 문제 n개짜리 큐. */
  const learningQueue = (n: number) =>
    Array.from({ length: n }, (_, i) => makeQuestion({ word: makeWord({ hanzi: `词${i}` }) }));

  it("35문제 세션을 전부 오답으로 소진해도 queue.length가 35에서 변하지 않는다", () => {
    let state = startSession(learningQueue(35));
    while (!isDone(state)) {
      state = recordAnswer(state, false).state;
      expect(state.queue).toHaveLength(35);
      state = advance(state);
    }
    expect(state.wrong).toBe(35);
    expect(state.pos).toBe(35);
  });

  it("같은 단어를 연속으로 틀려도 큐 뒤에 사본이 쌓이지 않는다", () => {
    let state = startSession(learningQueue(2));
    state = recordAnswer(state, false).state;
    state = advance(state);
    expect(currentQuestion(state)?.word.hanzi).toBe("词1"); // 재삽입분이 아니라 다음 원본
    state = recordAnswer(state, false).state;
    expect(state.queue).toHaveLength(2);
    expect(advance(state).pos).toBe(2);
    expect(isDone(advance(state))).toBe(true);
  });

  it("복습 오답도 큐를 늘리지 않는다 — 두 상태의 규칙이 같아졌다", () => {
    const questions = [makeQuestion({ isReview: true }), makeQuestion()];
    const { state: next, effect } = recordAnswer(startSession(questions), false);
    expect(effect).toMatchObject({ kind: "review-fail" });
    expect(next.queue).toEqual(questions);
  });
});

describe("세션 흐름 집계", () => {
  it("정오가 섞인 세션의 correct/wrong 합계가 완료 화면 수치와 일치한다", () => {
    // 학습 중 3문제: 정답 → 오답 → 정답. 오답이 있어도 큐는 3문제 그대로다(#116).
    let state = sessionAt([
      makeQuestion(),
      makeQuestion({ word: makeWord({ hanzi: "严重" }) }),
      makeQuestion({ word: makeWord({ hanzi: "环境" }), mode: "m2" }),
    ]);
    state = advance(recordAnswer(state, true).state);
    state = advance(recordAnswer(state, false).state);
    expect(isDone(state)).toBe(false);
    state = advance(recordAnswer(state, true).state);
    expect(state.queue).toHaveLength(3);
    expect(isDone(state)).toBe(true);
    expect(state.correct).toBe(2);
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
