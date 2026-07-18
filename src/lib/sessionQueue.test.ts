import { describe, expect, it } from "vitest";
import { buildSessionQueue, SESSION_CAP, type SessionQuestion } from "./sessionQueue.ts";

const today = "2026-07-20";

interface TestWord {
  tab: string;
  hanzi: string;
  m1: number;
  m2: number;
  nextReview: string | null;
}

/** 학습 중 단어 (미졸업 → nextReview 없음이 정상 흐름). */
function learningWord(hanzi: string, m1: number, m2: number): TestWord {
  return { tab: "HSK6", hanzi, m1, m2, nextReview: null };
}

/** 복습 대기 단어 (졸업 + 복습일 도래). nextReview: null은 데이터 이상 케이스. */
function reviewWord(hanzi: string, nextReview: string | null): TestWord {
  return { tab: "HSK6", hanzi, m1: 3, m2: 3, nextReview };
}

/** 결정론적 [0,1) 난수 생성기 — 셔플·모드 선택을 시드로 고정한다. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hanziSet(queue: SessionQuestion<TestWord>[]): Set<string> {
  return new Set(queue.map((q) => q.word.hanzi));
}

function questionsOf(queue: SessionQuestion<TestWord>[], hanzi: string): SessionQuestion<TestWord>[] {
  return queue.filter((q) => q.word.hanzi === hanzi);
}

function hasAdjacentSameWord(queue: SessionQuestion<TestWord>[]): boolean {
  return queue.some(
    (q, i) => i > 0 && q.word.tab === queue[i - 1].word.tab && q.word.hanzi === queue[i - 1].word.hanzi,
  );
}

describe("buildSessionQueue — 복습 대기 선별", () => {
  it("복습 대기가 60개를 넘으면 복습일 오래된 순으로 60개만 남는다", () => {
    // 시트 순서와 복습일 순서가 다르도록 날짜를 역순으로 배치한다 (5/01~6/30, 61개)
    const words = Array.from({ length: 61 }, (_, i) => {
      const day = 61 - i; // i=0 → 가장 최신(6/30), i=60 → 가장 오래됨(5/01)
      const date = day > 31 ? `2026-06-${String(day - 31).padStart(2, "0")}` : `2026-05-${String(day).padStart(2, "0")}`;
      return reviewWord(`복${i}`, date);
    });
    const queue = buildSessionQueue(words, today, mulberry32(1));

    expect(queue).toHaveLength(SESSION_CAP);
    expect(hanziSet(queue).has("복0")).toBe(false); // 가장 최신 복습일(6/30)만 잘린다
    expect(hanziSet(queue).has("복60")).toBe(true); // 가장 오래된 복습일(5/01)은 포함
    expect(queue.every((q) => q.isReview)).toBe(true);
    expect(hanziSet(queue).size).toBe(SESSION_CAP); // 단어당 1문제
  });

  it("nextReview: null(데이터 이상)인 복습 대기 단어는 가장 오래된 것으로 취급해 최우선 포함된다", () => {
    const dated = Array.from({ length: 60 }, (_, i) =>
      reviewWord(`복${i}`, `2026-06-${String((i % 28) + 1).padStart(2, "0")}`),
    );
    const anomaly = reviewWord("이상", null);
    const queue = buildSessionQueue([...dated, anomaly], today, mulberry32(1));

    expect(queue).toHaveLength(SESSION_CAP);
    expect(hanziSet(queue).has("이상")).toBe(true);
  });

  it("복습 단어는 단어당 1문제이고 모드는 rng로 정해진다", () => {
    const words = [reviewWord("경제", "2026-07-19")];
    expect(buildSessionQueue(words, today, () => 0)).toEqual([
      { word: words[0], mode: "m1", isReview: true },
    ]);
    expect(buildSessionQueue(words, today, () => 0.7)).toEqual([
      { word: words[0], mode: "m2", isReview: true },
    ]);
  });
});

describe("buildSessionQueue — 학습 중 채우기", () => {
  it("총 정답 수(D+E)가 많은 단어부터 채우고, 동률이면 시트 순서를 따른다", () => {
    // 29개 고득점 단어(후보 58개) + 동률(0점) 2개 — 남은 슬롯 2개를 시트 순서가
    // 앞서는 "동앞"이 가져가고 "동뒤"는 전부 밀려난다
    const high = Array.from({ length: 29 }, (_, i) => learningWord(`학${i}`, 2, i % 3));
    const tieFirst = learningWord("동앞", 0, 0);
    const tieSecond = learningWord("동뒤", 0, 0);
    const queue = buildSessionQueue([tieSecond, ...high, tieFirst], today, mulberry32(2));
    // 입력(시트) 순서상 "동뒤"가 "동앞"보다 앞이므로, 동률에서는 "동뒤"가 이긴다

    expect(queue).toHaveLength(SESSION_CAP);
    expect(hanziSet(queue).has("동뒤")).toBe(true);
    expect(hanziSet(queue).has("동앞")).toBe(false);
  });

  it("모드별 카운트가 3 이상이면 그 모드 문제는 만들지 않는다 (단어당 최대 2문제)", () => {
    const queue = buildSessionQueue(
      [learningWord("갑", 3, 1), learningWord("을", 0, 4), learningWord("병", 1, 2)],
      today,
      mulberry32(3),
    );

    expect(questionsOf(queue, "갑").map((q) => q.mode)).toEqual(["m2"]);
    expect(questionsOf(queue, "을").map((q) => q.mode)).toEqual(["m1"]);
    expect(questionsOf(queue, "병").map((q) => q.mode).toSorted()).toEqual(["m1", "m2"]);
    expect(queue.every((q) => !q.isReview)).toBe(true);
  });
});

describe("buildSessionQueue — 상한·제외·경계", () => {
  it("복습 30 + 학습 후보 80이면 전체 60문제 상한을 지킨다", () => {
    const reviews = Array.from({ length: 30 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    const learnings = Array.from({ length: 40 }, (_, i) => learningWord(`학${i}`, i % 3, 0));
    const queue = buildSessionQueue([...reviews, ...learnings], today, mulberry32(4));

    expect(queue).toHaveLength(SESSION_CAP);
    expect(queue.filter((q) => q.isReview)).toHaveLength(30);
    expect(queue.filter((q) => !q.isReview)).toHaveLength(30);
  });

  it("복습 예약(복습일 미도래) 단어는 큐에서 제외된다", () => {
    const queue = buildSessionQueue(
      [reviewWord("예약", "2026-07-21"), reviewWord("대기", "2026-07-20")],
      today,
      mulberry32(5),
    );

    expect(hanziSet(queue).has("예약")).toBe(false);
    expect(hanziSet(queue).has("대기")).toBe(true);
  });

  it("빈 입력이면 빈 큐를 돌려준다", () => {
    expect(buildSessionQueue([], today, mulberry32(6))).toEqual([]);
  });
});

describe("buildSessionQueue — 셔플 분산", () => {
  it("분산 가능한 구성에서는 같은 단어의 두 문제가 연달아 나오지 않는다 (시드 20종)", () => {
    // 학습 12단어 × 2문제 + 복습 6단어 = 30문제 — 단어 종류가 충분해 분산 가능
    const learnings = Array.from({ length: 12 }, (_, i) => learningWord(`학${i}`, 0, 0));
    const reviews = Array.from({ length: 6 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    for (let seed = 1; seed <= 20; seed++) {
      const queue = buildSessionQueue([...learnings, ...reviews], today, mulberry32(seed));
      expect(queue).toHaveLength(30);
      expect(hasAdjacentSameWord(queue)).toBe(false);
    }
  });

  it("탭이 다르면 같은 한자라도 다른 단어로 취급한다", () => {
    const a = { ...learningWord("经济", 0, 0), tab: "HSK4" };
    const b = { ...learningWord("经济", 0, 0), tab: "HSK6" };
    const queue = buildSessionQueue([a, b], today, mulberry32(7));

    expect(queue).toHaveLength(4);
    // a·b 각각 2문제 — tab이 분리 키로 동작해 인접 판정이 단어 단위로 이뤄지는지만 확인
    expect(queue.filter((q) => q.word.tab === "HSK4")).toHaveLength(2);
  });
});
