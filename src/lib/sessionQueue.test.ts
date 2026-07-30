import { describe, expect, it } from "vitest";
import { computeHomeStats } from "./homeStats.ts";
import { buildSessionQueue, SESSION_CAP, type SessionQuestion } from "./sessionQueue.ts";

const today = "2026-07-20";
const M = ["m1", "m2"] as const;

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

/** 유일성 판정 키 — 탭이 다르면 같은 한자라도 다른 단어다. */
function wordKeys(queue: SessionQuestion<TestWord>[]): string[] {
  return queue.map((q) => `${q.word.tab}\t${q.word.hanzi}`);
}

describe("buildSessionQueue — 복습 대기 선별", () => {
  it("복습 대기가 60개를 넘으면 복습일 오래된 순으로 60개만 남는다", () => {
    // 시트 순서와 복습일 순서가 다르도록 날짜를 역순으로 배치한다 (5/01~6/30, 61개)
    const words = Array.from({ length: 61 }, (_, i) => {
      const day = 61 - i; // i=0 → 가장 최신(6/30), i=60 → 가장 오래됨(5/01)
      const date = day > 31 ? `2026-06-${String(day - 31).padStart(2, "0")}` : `2026-05-${String(day).padStart(2, "0")}`;
      return reviewWord(`복${i}`, date);
    });
    const queue = buildSessionQueue(words, today, M, mulberry32(1));

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
    const queue = buildSessionQueue([...dated, anomaly], today, M, mulberry32(1));

    expect(queue).toHaveLength(SESSION_CAP);
    expect(hanziSet(queue).has("이상")).toBe(true);
  });

  it("복습 단어는 단어당 1문제이고 모드는 rng로 정해진다", () => {
    const words = [reviewWord("경제", "2026-07-19")];
    expect(buildSessionQueue(words, today, M, () => 0)).toEqual([
      { word: words[0], mode: "m1", isReview: true },
    ]);
    expect(buildSessionQueue(words, today, M, () => 0.7)).toEqual([
      { word: words[0], mode: "m2", isReview: true },
    ]);
  });
});

describe("buildSessionQueue — 학습 중 채우기", () => {
  it("총 정답 수(D+E)가 적은 단어부터 채운다 — 신규 단어가 최우선 (#128)", () => {
    // 후보 61개(상한 60) — 오름차순이라 시트 맨 뒤에 등록된 0점 단어가 들어가고
    // 최고점 단어가 밀려난다. 종전 내림차순에서는 정확히 반대였다.
    const top = learningWord("최고", 2, 2); // D+E=4 — 유일한 최고점, 시트 맨 앞
    const scored = Array.from({ length: 59 }, (_, i) => learningWord(`학${i}`, 1, 1)); // D+E=2
    const fresh = learningWord("신규", 0, 0); // D+E=0 — 방금 등록해 시트 맨 뒤
    const queue = buildSessionQueue([top, ...scored, fresh], today, M, mulberry32(2));

    expect(queue).toHaveLength(SESSION_CAP);
    expect(hanziSet(queue).has("신규")).toBe(true);
    expect(hanziSet(queue).has("최고")).toBe(false);
  });

  it("총 정답 수가 동률이면 시트 상 순서를 따른다 (stable sort)", () => {
    // 0점 동률 2개 중 하나만 들어가도록 상한을 1로 좁힌다 — 시트에서 앞선 쪽이 이긴다
    const queue = buildSessionQueue(
      [learningWord("동앞", 0, 0), learningWord("동뒤", 0, 0)],
      today,
      M,
      mulberry32(2),
      1,
    );

    expect(hanziSet(queue).has("동앞")).toBe(true);
    expect(hanziSet(queue).has("동뒤")).toBe(false);
  });

  it("한쪽 모드만 미달이면 그 모드로 단어당 1문제만 낸다", () => {
    const queue = buildSessionQueue(
      [learningWord("갑", 3, 1), learningWord("을", 0, 4)],
      today,
      M,
      mulberry32(3),
    );

    expect(questionsOf(queue, "갑").map((q) => q.mode)).toEqual(["m2"]);
    expect(questionsOf(queue, "을").map((q) => q.mode)).toEqual(["m1"]);
    expect(queue.every((q) => !q.isReview)).toBe(true);
  });

  it("양쪽 모드가 모두 미달이어도 1문제만 내고 모드는 rng로 정해진다 (#44)", () => {
    const words = [learningWord("병", 1, 2)];
    expect(buildSessionQueue(words, today, M, () => 0)).toEqual([
      { word: words[0], mode: "m1", isReview: false },
    ]);
    expect(buildSessionQueue(words, today, M, () => 0.7)).toEqual([
      { word: words[0], mode: "m2", isReview: false },
    ]);
  });

  it("신규 단어만 48개면 홈 산식과 같은 48문제가 나온다 (#44)", () => {
    const words = Array.from({ length: 48 }, (_, i) => learningWord(`신${i}`, 0, 0));
    const queue = buildSessionQueue(words, today, M, mulberry32(8));

    expect(queue).toHaveLength(48);
    expect(hanziSet(queue).size).toBe(48); // 단어당 1문제
  });
});

describe("buildSessionQueue — 상한·제외·경계", () => {
  it("복습 30 + 학습 40이면 전체 60문제 상한을 지킨다", () => {
    const reviews = Array.from({ length: 30 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    const learnings = Array.from({ length: 40 }, (_, i) => learningWord(`학${i}`, i % 3, 0));
    const queue = buildSessionQueue([...reviews, ...learnings], today, M, mulberry32(4));

    // 복습 몫은 floor(60×0.3)=18이지만 학습 후보가 40개뿐이라 남은 20슬롯을 복습이 회수한다(#128)
    expect(queue).toHaveLength(SESSION_CAP);
    expect(queue.filter((q) => q.isReview)).toHaveLength(20);
    expect(queue.filter((q) => !q.isReview)).toHaveLength(40);
  });

  it("복습 예약(복습일 미도래) 단어는 큐에서 제외된다", () => {
    const queue = buildSessionQueue(
      [reviewWord("예약", "2026-07-21"), reviewWord("대기", "2026-07-20")],
      today,
      M,
      mulberry32(5),
    );

    expect(hanziSet(queue).has("예약")).toBe(false);
    expect(hanziSet(queue).has("대기")).toBe(true);
  });

  it("빈 입력이면 빈 큐를 돌려준다", () => {
    expect(buildSessionQueue([], today, M, mulberry32(6))).toEqual([]);
  });
});

describe("buildSessionQueue — 단어 유일성 (#44)", () => {
  it("복습·학습이 섞여도 같은 단어는 큐에 한 번만 들어간다 (시드 20종)", () => {
    // 학습 12단어 + 복습 6단어 = 18문제 — 단어당 1문제라 어떤 셔플에서도 중복 없음
    const learnings = Array.from({ length: 12 }, (_, i) => learningWord(`학${i}`, 0, 0));
    const reviews = Array.from({ length: 6 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    for (let seed = 1; seed <= 20; seed++) {
      const queue = buildSessionQueue([...learnings, ...reviews], today, M, mulberry32(seed));
      expect(queue).toHaveLength(18);
      expect(new Set(wordKeys(queue)).size).toBe(queue.length);
    }
  });

  it("탭이 다르면 같은 한자라도 다른 단어로 취급해 각각 1문제씩 낸다", () => {
    const a = { ...learningWord("经济", 0, 0), tab: "HSK4" };
    const b = { ...learningWord("经济", 0, 0), tab: "HSK6" };
    const queue = buildSessionQueue([a, b], today, M, mulberry32(7));

    expect(queue).toHaveLength(2);
    expect(queue.filter((q) => q.word.tab === "HSK4")).toHaveLength(1);
  });
});

describe("buildSessionQueue — limit 파라미터화 (세션 설정 플랜 §3.2, #104)", () => {
  it("limit을 생략하면 SESSION_CAP(60)이 그대로 상한이다 — 기존 동작 보존", () => {
    const reviews = Array.from({ length: 70 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    const queue = buildSessionQueue(reviews, today, M, mulberry32(11));

    expect(queue).toHaveLength(SESSION_CAP);
  });

  it("limit=30이면 복습 대기 컷과 총 상한 모두 30이다", () => {
    const reviews = Array.from({ length: 40 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    const queue = buildSessionQueue(reviews, today, M, mulberry32(12), 30);

    expect(queue).toHaveLength(30);
    expect(queue.every((q) => q.isReview)).toBe(true);
  });

  it("limit=30이면 복습 20 + 학습 40이어도 총 30문제로 캡된다", () => {
    const reviews = Array.from({ length: 20 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    const learnings = Array.from({ length: 40 }, (_, i) => learningWord(`학${i}`, i % 3, 0));
    const queue = buildSessionQueue([...reviews, ...learnings], today, M, mulberry32(13), 30);

    // 양쪽 다 넉넉하므로 복습은 몫 floor(30×0.3)=9까지만 가져간다(#128)
    expect(queue).toHaveLength(30);
    expect(queue.filter((q) => q.isReview)).toHaveLength(9);
    expect(queue.filter((q) => !q.isReview)).toHaveLength(21);
  });

  it("limit=1이면 큐는 정확히 1문제다", () => {
    const words = [reviewWord("복", "2026-07-01"), learningWord("학", 0, 0)];
    const queue = buildSessionQueue(words, today, M, mulberry32(14), 1);

    expect(queue).toHaveLength(1);
  });
});

describe("buildSessionQueue — 신규 단어 기아 방지 (#128)", () => {
  it("학습 중이 상한을 훌쩍 넘겨도 갓 등록한 단어가 큐에 들어온다", () => {
    // 소유자 제보 시나리오: 이미 학습 중인 단어가 상한(35)보다 많은 시트에 5개를 새로 등록.
    // 종전 내림차순에서는 신규 5개가 전부 잘려 "등록했는데 안 나온다"가 됐다.
    const existing = Array.from({ length: 40 }, (_, i) => learningWord(`기존${i}`, 1, i % 3));
    const registered = Array.from({ length: 5 }, (_, i) => learningWord(`신규${i}`, 0, 0));
    const queue = buildSessionQueue([...existing, ...registered], today, M, mulberry32(20), 35);

    expect(queue).toHaveLength(35);
    for (let i = 0; i < 5; i++) {
      expect(hanziSet(queue).has(`신규${i}`)).toBe(true);
    }
  });

  it("실측 분포(학습 145 / 상한 35)에서 큐가 전부 0점 신규 단어가 된다", () => {
    // 이슈 실측(zh 프로필, 2026-07-30): 5점 4 / 4점 4 / 3점 4 / 2점 3 / 1점 4 / 0점 126.
    // 종전에는 점수 있는 19개가 슬롯을 먼저 먹고 남은 16자리만 0점에 돌아갔다.
    const scored = [
      ...Array.from({ length: 4 }, (_, i) => learningWord(`5점${i}`, 3, 2)),
      ...Array.from({ length: 4 }, (_, i) => learningWord(`4점${i}`, 2, 2)),
      ...Array.from({ length: 4 }, (_, i) => learningWord(`3점${i}`, 2, 1)),
      ...Array.from({ length: 3 }, (_, i) => learningWord(`2점${i}`, 1, 1)),
      ...Array.from({ length: 4 }, (_, i) => learningWord(`1점${i}`, 1, 0)),
    ];
    const fresh = Array.from({ length: 126 }, (_, i) => learningWord(`신${i}`, 0, 0));
    const queue = buildSessionQueue([...scored, ...fresh], today, M, mulberry32(21), 35);

    expect(queue).toHaveLength(35);
    expect(queue.every((q) => q.word.m1 + q.word.m2 === 0)).toBe(true);
    // 0점 풀이 상한보다 크므로 이번 세션은 시트 앞 35개 — 맞힌 단어가 뒤로 빠지며 다음 세션에 전진한다
    expect(hanziSet(queue).has("신0")).toBe(true);
    expect(hanziSet(queue).has("신34")).toBe(true);
    expect(hanziSet(queue).has("신35")).toBe(false);
  });

  it("복습 대기가 많아도 학습 슬롯이 확보된다 — 복습 몫 상한 30%", () => {
    const reviews = Array.from({ length: 100 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    const learnings = Array.from({ length: 145 }, (_, i) => learningWord(`학${i}`, 0, 0));
    const queue = buildSessionQueue([...reviews, ...learnings], today, M, mulberry32(22), 35);

    expect(queue).toHaveLength(35);
    expect(queue.filter((q) => q.isReview)).toHaveLength(10); // floor(35 × 0.3)
    expect(queue.filter((q) => !q.isReview)).toHaveLength(25);
  });

  it("학습 중이 없으면 복습이 상한 전부를 쓴다 — 몫은 하한이지 낭비 상한이 아니다", () => {
    const reviews = Array.from({ length: 100 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    const queue = buildSessionQueue(reviews, today, M, mulberry32(23), 35);

    expect(queue).toHaveLength(35);
    expect(queue.every((q) => q.isReview)).toBe(true);
  });

  it("limit=3이면 floor(3×0.3)=0이어도 복습 대기가 최소 1문제는 확보된다", () => {
    // 복습 누락 방지 우선(PRD §12)이 작은 상한에서도 깨지지 않아야 한다
    const reviews = Array.from({ length: 5 }, (_, i) => reviewWord(`복${i}`, "2026-07-01"));
    const learnings = Array.from({ length: 10 }, (_, i) => learningWord(`학${i}`, 0, 0));
    const queue = buildSessionQueue([...reviews, ...learnings], today, M, mulberry32(24), 3);

    expect(queue).toHaveLength(3);
    expect(queue.filter((q) => q.isReview)).toHaveLength(1);
    expect(queue.filter((q) => !q.isReview)).toHaveLength(2);
  });
});

describe("buildSessionQueue — 홈 산식과의 불변식 (#128)", () => {
  it("어떤 조합에서도 큐 길이가 computeHomeStats의 sessionCount와 같다", () => {
    // HomeScreen이 "같은 산식이라 빈 큐가 나올 수 없다"에 기대므로, 두 함수가 갈라지면 즉시 실패한다
    for (const limit of [1, 2, 3, 30, 35, 60]) {
      for (const reviewCount of [0, 1, 5, 30, 100]) {
        for (const learningCount of [0, 1, 5, 30, 100]) {
          const words = [
            ...Array.from({ length: reviewCount }, (_, i) => reviewWord(`복${i}`, "2026-07-01")),
            ...Array.from({ length: learningCount }, (_, i) => learningWord(`학${i}`, i % 4, 0)),
          ];
          const queue = buildSessionQueue(words, today, M, mulberry32(limit + reviewCount + learningCount), limit);
          const stats = computeHomeStats(words, today, M, limit);

          expect(queue).toHaveLength(stats.sessionCount);
        }
      }
    }
  });
});

describe("buildSessionQueue — M 파라미터화 (#76)", () => {
  it("M={m1}이면 복습·학습 중 문제가 전부 m1이다", () => {
    // m2:0인 채로 m1만 3 이상이면 M={m1} 기준으로 졸업(복습 대기) — 상태 분류도 M을 탄다(#75)
    const reviewing = reviewWord("복", "2026-07-19");
    reviewing.m2 = 0;
    const learning1 = learningWord("학1", 0, 0); // 양쪽 다 미달 — M={m1}이면 m1만 후보
    const learning2 = learningWord("학2", 0, 4); // m2는 M 밖 — m1만 보고 미달 판정
    const queue = buildSessionQueue([reviewing, learning1, learning2], today, ["m1"], mulberry32(9));

    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((q) => q.mode === "m1")).toBe(true);
    expect(queue.some((q) => q.isReview)).toBe(true);
    expect(queue.some((q) => !q.isReview)).toBe(true);
  });

  it("M={m2}이면 복습·학습 중 문제가 전부 m2다 (대칭 케이스)", () => {
    const reviewing = reviewWord("복", "2026-07-19");
    reviewing.m1 = 0;
    const learning1 = learningWord("학1", 0, 0);
    const learning2 = learningWord("학2", 4, 0);
    const queue = buildSessionQueue([reviewing, learning1, learning2], today, ["m2"], mulberry32(10));

    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((q) => q.mode === "m2")).toBe(true);
    expect(queue.some((q) => q.isReview)).toBe(true);
    expect(queue.some((q) => !q.isReview)).toBe(true);
  });

  it("M이 1개뿐이면 복습 문제도 rng 값과 무관하게 항상 그 모드다", () => {
    const words = [reviewWord("복", "2026-07-19")];
    expect(buildSessionQueue(words, today, ["m2"], () => 0)).toEqual([
      { word: words[0], mode: "m2", isReview: true },
    ]);
    expect(buildSessionQueue(words, today, ["m2"], () => 0.99)).toEqual([
      { word: words[0], mode: "m2", isReview: true },
    ]);
  });
});
