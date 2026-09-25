import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STUDY_SCOPE_STORAGE_KEY,
  deriveTabs,
  filterWordsByScope,
  getLastTabSelection,
  restoreStudyScope,
  saveStudyScope,
  type StudyScope,
} from "./studyScope";

// vitest는 node 환경이라 localStorage가 없다 — retryQueue.test.ts와 같은 스텁(#18/#79 전례).
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

beforeEach(() => {
  stubLocalStorage();
});

function word(tab: string, label: string): { tab: string; label: string } {
  return { tab, label };
}

function rawStore(): unknown {
  const raw = localStorage.getItem(STUDY_SCOPE_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe("deriveTabs", () => {
  it("처음 등장한 순서를 유지하며 중복을 제거한다", () => {
    const words = [word("HSK6", "가"), word("HSK5", "나"), word("HSK6", "다"), word("교재5과", "라")];
    expect(deriveTabs(words)).toEqual(["HSK6", "HSK5", "교재5과"]);
  });

  it("빈 입력이면 빈 배열을 반환한다", () => {
    expect(deriveTabs([])).toEqual([]);
  });
});

describe("filterWordsByScope", () => {
  const words = [word("HSK6", "가"), word("HSK5", "나"), word("교재5과", "다"), word("교재6과", "라")];

  it("kind가 all이면 전체를 그대로 반환한다", () => {
    expect(filterWordsByScope(words, { kind: "all" })).toEqual(words);
  });

  it("tabs가 빈 배열이면 결과도 빈 배열이다", () => {
    expect(filterWordsByScope(words, { kind: "tabs", tabs: [] })).toEqual([]);
  });

  it("탭 1개를 고르면 그 탭의 단어만 남는다", () => {
    expect(filterWordsByScope(words, { kind: "tabs", tabs: ["HSK5"] })).toEqual([word("HSK5", "나")]);
  });

  it("탭 n개를 고르면 합집합이 남고 순서는 입력 순서를 유지한다", () => {
    const result = filterWordsByScope(words, { kind: "tabs", tabs: ["교재6과", "HSK6"] });
    expect(result).toEqual([word("HSK6", "가"), word("교재6과", "라")]);
  });

  it("전체와 '모든 탭을 고른 탭 선택'은 다른 상태다 — 새 탭 포함 여부가 갈린다", () => {
    const allTabs = deriveTabs(words);
    const allScope: StudyScope = { kind: "all" };
    const everyTabScope: StudyScope = { kind: "tabs", tabs: allTabs };

    // 현재 탭 구성에서는 결과가 같다.
    expect(filterWordsByScope(words, allScope)).toEqual(words);
    expect(filterWordsByScope(words, everyTabScope)).toEqual(words);

    // 새 탭이 생기면 전체는 자동 포함, "모든 탭 선택"은 저장된 탭 이름만 포함한다(§3).
    const withNewTab = [...words, word("신규탭", "마")];
    expect(filterWordsByScope(withNewTab, allScope)).toHaveLength(5);
    expect(filterWordsByScope(withNewTab, everyTabScope)).toHaveLength(4);
  });

  it("탭 이름은 정확히 일치해야 한다 — 트림·대소문자 무시 없음", () => {
    const mixedCase = [word("hsk6", "가"), word("HSK6", "나"), word(" HSK6", "다")];
    expect(filterWordsByScope(mixedCase, { kind: "tabs", tabs: ["HSK6"] })).toEqual([word("HSK6", "나")]);
  });
});

describe("saveStudyScope / restoreStudyScope", () => {
  it("저장값이 없으면 전체로 복원한다", () => {
    expect(restoreStudyScope("p1", ["HSK6"])).toEqual({ kind: "all" });
  });

  it("저장한 탭 선택을 그대로 복원한다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["HSK6", "HSK5"] });
    expect(restoreStudyScope("p1", ["HSK6", "HSK5", "교재5과"])).toEqual({ kind: "tabs", tabs: ["HSK6", "HSK5"] });
  });

  it("전체 저장도 복원된다", () => {
    saveStudyScope("p1", { kind: "all" });
    expect(restoreStudyScope("p1", ["HSK6"])).toEqual({ kind: "all" });
  });

  it("선택 0개는 저장하지 않는다 — 마지막으로 비어있지 않았던 선택이 남는다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["HSK6"] });
    saveStudyScope("p1", { kind: "tabs", tabs: [] });
    expect(restoreStudyScope("p1", ["HSK6"])).toEqual({ kind: "tabs", tabs: ["HSK6"] });
  });

  it("전체로 바꿔도 이전 탭 선택은 저장값에 그대로 보존된다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["HSK6", "교재5과"] });
    saveStudyScope("p1", { kind: "all" });
    const store = rawStore() as Record<string, { kind: string; tabs: string[] }>;
    expect(store.p1).toEqual({ kind: "all", tabs: ["HSK6", "교재5과"] });
  });

  it("손상된 JSON이면 전체로 복원한다", () => {
    localStorage.setItem(STUDY_SCOPE_STORAGE_KEY, "{not json");
    expect(restoreStudyScope("p1", ["HSK6"])).toEqual({ kind: "all" });
  });

  it("프로필 엔트리의 타입이 어긋나면 그 프로필만 전체로 취급한다", () => {
    localStorage.setItem(
      STUDY_SCOPE_STORAGE_KEY,
      JSON.stringify({ p1: { kind: "tabs", tabs: "not-an-array" }, p2: { kind: "tabs", tabs: ["HSK6"] } }),
    );
    expect(restoreStudyScope("p1", ["HSK6"])).toEqual({ kind: "all" });
    expect(restoreStudyScope("p2", ["HSK6"])).toEqual({ kind: "tabs", tabs: ["HSK6"] });
  });

  it("일부 탭이 응답에 없으면 조용히 빼고 저장값도 갱신한다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["HSK6", "교재5과", "교재6과"] });
    expect(restoreStudyScope("p1", ["HSK6", "교재6과"])).toEqual({ kind: "tabs", tabs: ["HSK6", "교재6과"] });

    const store = rawStore() as Record<string, { kind: string; tabs: string[] }>;
    expect(store.p1).toEqual({ kind: "tabs", tabs: ["HSK6", "교재6과"] });
  });

  it("남은 탭이 없으면 전체로 되돌리고 저장값도 갱신한다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["삭제된탭"] });
    expect(restoreStudyScope("p1", ["HSK6"])).toEqual({ kind: "all" });

    const store = rawStore() as Record<string, { kind: string; tabs: string[] }>;
    expect(store.p1).toEqual({ kind: "all", tabs: [] });
  });

  it("정리할 탭이 없으면 저장값을 다시 쓰지 않는다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["HSK6"] });
    const before = localStorage.getItem(STUDY_SCOPE_STORAGE_KEY);
    restoreStudyScope("p1", ["HSK6", "교재5과"]);
    expect(localStorage.getItem(STUDY_SCOPE_STORAGE_KEY)).toBe(before);
  });

  it("프로필 간 선택이 격리된다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["HSK6"] });
    saveStudyScope("p2", { kind: "tabs", tabs: ["교재5과"] });

    expect(restoreStudyScope("p1", ["HSK6", "교재5과"])).toEqual({ kind: "tabs", tabs: ["HSK6"] });
    expect(restoreStudyScope("p2", ["HSK6", "교재5과"])).toEqual({ kind: "tabs", tabs: ["교재5과"] });
  });

  it("한 프로필의 탭 정리가 다른 프로필 엔트리를 건드리지 않는다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["삭제된탭"] });
    saveStudyScope("p2", { kind: "tabs", tabs: ["HSK6"] });

    restoreStudyScope("p1", ["HSK6"]);

    const store = rawStore() as Record<string, { kind: string; tabs: string[] }>;
    expect(store.p2).toEqual({ kind: "tabs", tabs: ["HSK6"] });
  });
});

describe("getLastTabSelection", () => {
  it("공개 API 왕복으로 전체 전환 후에도 마지막 탭 선택을 읽을 수 있다 (r1 리뷰 major)", () => {
    saveStudyScope("zh", { kind: "tabs", tabs: ["HSK6", "교재5과"] });
    saveStudyScope("zh", { kind: "all" });

    expect(restoreStudyScope("zh", ["HSK6", "HSK5", "교재5과"])).toEqual({ kind: "all" });
    expect(getLastTabSelection("zh", ["HSK6", "HSK5", "교재5과"])).toEqual(["HSK6", "교재5과"]);
  });

  it("탭 선택 상태에서는 활성 범위의 tabs와 같다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["HSK6"] });
    expect(getLastTabSelection("p1", ["HSK6", "HSK5"])).toEqual(["HSK6"]);
  });

  it("저장값이 없으면 빈 배열이다", () => {
    expect(getLastTabSelection("p1", ["HSK6"])).toEqual([]);
  });

  it("손상된 저장값이면 빈 배열이다", () => {
    localStorage.setItem(STUDY_SCOPE_STORAGE_KEY, "{not json");
    expect(getLastTabSelection("p1", ["HSK6"])).toEqual([]);
  });

  it("availableTabs에 없는 탭은 걸러진다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["HSK6", "삭제된탭"] });
    expect(getLastTabSelection("p1", ["HSK6"])).toEqual(["HSK6"]);
  });

  it("보존된 탭이 전부 걸러지면 빈 배열이다", () => {
    saveStudyScope("p1", { kind: "tabs", tabs: ["삭제된탭"] });
    saveStudyScope("p1", { kind: "all" });
    expect(getLastTabSelection("p1", ["HSK6"])).toEqual([]);
  });
});
