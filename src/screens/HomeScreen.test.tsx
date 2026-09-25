// @vitest-environment jsdom
//
// 홈 화면의 진입 액션 배치 회귀 테스트 (#105) — 유틸 바가 헤더에 있고, 옛 하단 저강조
// 링크 2개는 사라졌으며, 유틸 바의 액션이 App에서 내려온 prop까지 실제로 이어지는지.
// 수정 버튼은 메뉴 없이 즉시 등록 화면으로 이동한다(#112). 세션 큐·현황 집계 로직은
// 이 작업의 대상이 아니라 fetchWords만 고정 응답으로 대체한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeScreen from "./HomeScreen.tsx";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import { clearPassword, type PublicProfile, type WordEntry } from "../lib/api.ts";
import { computeHomeStats } from "../lib/homeStats.ts";
import type { SessionQuestion } from "../lib/sessionQueue.ts";
import { STUDY_SCOPE_STORAGE_KEY, saveStudyScope } from "../lib/studyScope.ts";
import { getSeoulToday } from "../lib/wordState.ts";
import type { WordsResponse } from "../lib/wordsApi.ts";

const { fetchWordsMock } = vi.hoisted(() => ({ fetchWordsMock: vi.fn() }));

vi.mock("../lib/wordsApi.ts", () => ({ fetchWords: fetchWordsMock }));

const profile: PublicProfile = { id: "hsk6", name: "HSK 6급", modes: ["m1", "m2"], contentType: "zh" };
const wordsResponse: WordsResponse = { profile, words: [], settings: { sessionLimit: 60 }, tts: { enabled: false } };

let unmountCurrent: (() => void) | null = null;

beforeEach(() => {
  fetchWordsMock.mockReset();
  fetchWordsMock.mockResolvedValue(wordsResponse);
  localStorage.clear();
});

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
});

function setup() {
  const onStart = vi.fn();
  const onNavigateRegister = vi.fn();
  const onSwitchProfile = vi.fn();
  const { container, unmount } = renderComponent(
    <HomeScreen onStart={onStart} onNavigateRegister={onNavigateRegister} onSwitchProfile={onSwitchProfile} />,
  );
  unmountCurrent = unmount;

  const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return {
    container,
    onStart,
    onNavigateRegister,
    onSwitchProfile,
    startButton: () => container.querySelector<HTMLButtonElement>(".start-button")!,
    editButton: byLabel("수정")!,
    personButton: byLabel("프로필 전환")!,
  };
}

describe("HomeScreen 진입 액션 배치", () => {
  it("헤더에 유틸 바 버튼 2개를 렌더한다", async () => {
    const { container, editButton, personButton } = setup();
    await flush();

    // 목 응답이 실제로 ready 상태까지 갔는지 먼저 못박는다 — fetchWords 계약이 바뀌어
    // then 블록이 던지면 조용히 error 상태로 떨어지는데, 유틸 바는 그때도 보이기 때문에
    // 이 단언이 없으면 아래 검사가 통과하면서 회귀를 놓친다.
    expect(container.querySelector(".error-card")).toBeNull();
    expect(container.querySelectorAll(".status-card:not(.skeleton)")).toHaveLength(3);

    expect(editButton).not.toBeNull();
    expect(personButton).not.toBeNull();
    // 유틸 바는 날짜/타이틀 행 안에 있다 — 하단이 아니라 헤더 우측이라는 배치의 근거
    expect(container.querySelector(".home-header .home-util-bar")).not.toBeNull();
  });

  it("옛 하단 저강조 링크 2개는 더 이상 렌더하지 않는다", async () => {
    const { container } = setup();
    await flush();

    expect(container.querySelector(".home-register-link")).toBeNull();
    expect(container.querySelector(".home-switch-profile-link")).toBeNull();
    expect(container.textContent).not.toContain("단어 등록 ›");
  });

  it("수정 버튼을 누르면 메뉴 없이 등록 화면 이동 prop까지 즉시 이어진다 (#112)", async () => {
    const { editButton, onNavigateRegister } = setup();
    await flush();

    fire(() => editButton.click());

    expect(onNavigateRegister).toHaveBeenCalledTimes(1);
  });

  it("사람 버튼이 프로필 전환 prop까지 이어진다", async () => {
    const { personButton, onSwitchProfile } = setup();
    await flush();

    fire(() => personButton.click());

    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
  });

  it("단어 조회가 끝나기 전(로딩 상태)에도 유틸 바가 노출된다", () => {
    // 등록 진입이 가지고 있던 "오늘 학습 상태와 무관하게 항상 노출" 성질을 유틸 바가 승계한다
    fetchWordsMock.mockReturnValue(new Promise(() => {}));
    const { container, editButton, personButton } = setup();

    expect(container.querySelector(".status-card.skeleton")).not.toBeNull();
    expect(editButton).not.toBeNull();
    expect(personButton).not.toBeNull();
  });
});

describe("세션 시작 — 시트 문제 수 설정이 큐에 반영된다 (#113 → #116)", () => {
  const learningWord = (hanzi: string): WordEntry => ({
    tab: "HSK6",
    hanzi,
    pinyin: "jīngjì",
    meaning: "경제",
    m1: 1,
    m2: 0,
    nextReview: null,
    interval: null,
  });

  it("학습 시작이 시트 설정 상한(35)까지 자른 큐 하나만 올린다", async () => {
    // #116으로 재삽입이 사라져 세션 문제 수는 이 큐로 확정된다 — 상한이 큐 구성에서
    // 누락되면 학습 화면이 기본 60문제로 되돌아간다.
    fetchWordsMock.mockResolvedValue({
      profile,
      words: Array.from({ length: 50 }, (_, i) => learningWord(`词${i}`)),
      settings: { sessionLimit: 35 },
      tts: { enabled: true, revision: "session-r1", maxTextLength: 200 },
    } satisfies WordsResponse);
    const { onStart, startButton } = setup();
    await flush();

    fire(() => startButton().click());

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]).toHaveLength(2);
    expect(onStart.mock.calls[0][0]).toHaveLength(35);
    expect(onStart.mock.calls[0][1]).toEqual({
      profile,
      tts: { enabled: true, revision: "session-r1", maxTextLength: 200 },
    });
  });
});

describe("학습 범위 선택 (#189, PRD-tab-scoped-study §4)", () => {
  // 학습 중: 미졸업(m1<3) — 단어당 1문제. 복습 대기: 졸업 + 복습일 도래. 복습 예정: 졸업 + 미래 복습일.
  const learning = (tab: string, hanzi: string): WordEntry => ({
    tab,
    hanzi,
    pinyin: "",
    meaning: hanzi,
    m1: 1,
    m2: 0,
    nextReview: null,
    interval: null,
  });
  const reviewDue = (tab: string, hanzi: string): WordEntry => ({
    ...learning(tab, hanzi),
    m1: 3,
    m2: 3,
    nextReview: "2000-01-01",
    interval: 1,
  });
  const scheduled = (tab: string, hanzi: string): WordEntry => ({
    ...learning(tab, hanzi),
    m1: 3,
    m2: 3,
    nextReview: "2999-01-01",
    interval: 30,
  });
  const many = (make: (tab: string, hanzi: string) => WordEntry, tab: string, count: number) =>
    Array.from({ length: count }, (_, i) => make(tab, `${tab}-${i}`));

  function respondWith(words: WordEntry[], options: { sessionLimit?: number; profile?: PublicProfile } = {}) {
    fetchWordsMock.mockResolvedValue({
      profile: options.profile ?? profile,
      words,
      settings: { sessionLimit: options.sessionLimit ?? 60 },
      tts: { enabled: false },
    } satisfies WordsResponse);
  }

  async function mount() {
    const view = setup();
    await flush();
    const { container } = view;
    const radio = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((el) => el.textContent === label)!;
    return {
      ...view,
      picker: () => container.querySelector(".study-scope"),
      radio,
      chip: (tab: string) => container.querySelector<HTMLButtonElement>(`button.study-scope-chip[title="${tab}"]`)!,
      chipTexts: () => [...container.querySelectorAll(".study-scope-chip")].map((el) => el.textContent),
      pressedTabs: () =>
        [...container.querySelectorAll<HTMLButtonElement>('.study-scope-chip[aria-pressed="true"]')].map((el) => el.title),
      toggleAll: () => container.querySelector<HTMLButtonElement>(".study-scope-toggle-all")!,
      sessionCount: () => container.querySelector(".session-count")?.textContent ?? null,
      cards: () => [...container.querySelectorAll(".status-card-value")].map((el) => Number(el.textContent)),
      startQueue: () => {
        fire(() => view.startButton().click());
        return view.onStart.mock.calls.at(-1)![0] as SessionQuestion<WordEntry>[];
      },
    };
  }

  // 새로고침·재로그인 시나리오용 — 홈을 내렸다가 다시 마운트한다.
  function unmountHome() {
    unmountCurrent?.();
    unmountCurrent = null;
  }

  function storedScopes(): unknown {
    return JSON.parse(localStorage.getItem(STUDY_SCOPE_STORAGE_KEY) ?? "null");
  }

  it("저장값이 없으면 전체로 시작하고 수치·큐가 변경 전과 같다 (회귀 없음)", async () => {
    const words = [...many(learning, "HSK6", 3), reviewDue("HSK6", "복"), ...many(learning, "HSK5", 2), ...many(reviewDue, "HSK5", 2)];
    respondWith(words);
    const home = await mount();

    expect(home.radio("전체").getAttribute("aria-checked")).toBe("true");
    expect(home.radio("탭 선택").getAttribute("aria-checked")).toBe("false");
    expect(home.chipTexts()).toEqual([]);
    // 범위 도입 전 산식(전체 단어 그대로)과 같은 값이어야 한다
    const expected = computeHomeStats(words, getSeoulToday(), profile.modes, 60);
    expect(home.cards()).toEqual([expected.reviewDue, expected.learning, expected.graduated]);
    expect(home.sessionCount()).toBe(`오늘 세션 · ${expected.sessionCount}문제`);
    expect(home.startQueue()).toHaveLength(expected.sessionCount);
  });

  it("탭 선택으로 처음 바꾸면 문제 수가 가장 많은 탭 1개가 선택되고(동률이면 앞선 탭) 큐가 그 탭으로만 구성된다", async () => {
    respondWith([...many(learning, "HSK6", 2), ...many(learning, "HSK5", 3), ...many(learning, "교재5과", 3)]);
    const home = await mount();

    fire(() => home.radio("탭 선택").click());

    expect(home.chipTexts()).toEqual(["HSK6 · 2", "HSK5 · 3", "교재5과 · 3"]);
    expect(home.pressedTabs()).toEqual(["HSK5"]);
    expect(home.cards()).toEqual([0, 3, 0]);
    expect(home.sessionCount()).toBe("HSK5 · 오늘 세션 · 3문제");
    const queue = home.startQueue();
    expect(queue).toHaveLength(3);
    expect(queue.every((q) => q.word.tab === "HSK5")).toBe(true);
  });

  it("여러 탭을 고르면 세션 수는 칩 n의 합이 아니라 합집합 기준이며 큐 길이와 같다", async () => {
    // 미선택 탭 HSK6은 복습 대기라, 범위가 새면 복습 몫(최소 1문제) 때문에 반드시 큐에 들어온다
    respondWith([...many(learning, "교재5과", 4), ...many(learning, "교재6과", 4), reviewDue("HSK6", "복")], {
      sessionLimit: 5,
    });
    const home = await mount();

    fire(() => home.radio("탭 선택").click());
    fire(() => home.chip("교재6과").click());

    expect(home.chipTexts()).toEqual(["교재5과 · 4", "교재6과 · 4", "HSK6 · 1"]);
    expect(home.pressedTabs()).toEqual(["교재5과", "교재6과"]);
    // 4 + 4 = 8이 아니라 두 탭 합집합(8단어)에 상한 5를 적용한 값
    expect(home.sessionCount()).toBe("교재5과 외 1개 탭 · 오늘 세션 · 5문제");
    const queue = home.startQueue();
    expect(queue).toHaveLength(5);
    expect(queue.every((q) => q.word.tab === "교재5과" || q.word.tab === "교재6과")).toBe(true);
  });

  it("선택하지 않은 탭의 복습 대기는 카드·세션 수·큐 어디에도 잡히지 않는다", async () => {
    saveStudyScope(profile.id, { kind: "tabs", tabs: ["HSK6"] });
    respondWith([...many(learning, "HSK6", 2), ...many(reviewDue, "HSK5", 3), scheduled("HSK5", "예정")]);
    const home = await mount();

    expect(home.radio("탭 선택").getAttribute("aria-checked")).toBe("true");
    expect(home.cards()).toEqual([0, 2, 0]);
    expect(home.sessionCount()).toBe("HSK6 · 오늘 세션 · 2문제");
    const queue = home.startQueue();
    expect(queue).toHaveLength(2);
    expect(queue.some((q) => q.isReview || q.word.tab === "HSK5")).toBe(false);
  });

  it("모두 선택/선택 해제가 상태에 맞게 바뀌고, 0개 선택이면 시작 버튼이 '탭을 선택하세요'로 막힌다", async () => {
    saveStudyScope(profile.id, { kind: "tabs", tabs: ["HSK6"] });
    respondWith([...many(learning, "HSK6", 2), ...many(reviewDue, "HSK5", 1)]);
    const home = await mount();

    expect(home.toggleAll().textContent).toBe("모두 선택");
    fire(() => home.toggleAll().click());
    expect(home.pressedTabs()).toEqual(["HSK6", "HSK5"]);
    expect(home.toggleAll().textContent).toBe("선택 해제");

    fire(() => home.toggleAll().click());
    expect(home.pressedTabs()).toEqual([]);
    expect(home.toggleAll().textContent).toBe("모두 선택");
    expect(home.startButton().disabled).toBe(true);
    expect(home.startButton().textContent).toBe("탭을 선택하세요");
    expect(home.sessionCount()).toBeNull();
    expect(home.cards()).toEqual([0, 0, 0]);
    // 0개 선택은 저장하지 않는다 — 마지막으로 비어 있지 않았던 선택(모두 선택)이 남는다
    expect(storedScopes()).toEqual({ [profile.id]: { kind: "tabs", tabs: ["HSK6", "HSK5"] } });

    fire(() => home.chip("HSK5").click());
    expect(home.startButton().disabled).toBe(false);
    expect(home.startButton().textContent).toBe("학습 시작");
    expect(home.sessionCount()).toBe("HSK5 · 오늘 세션 · 1문제");
  });

  it("범위 안에 할 것이 없으면 기존처럼 '오늘 할 것 없음'이다", async () => {
    saveStudyScope(profile.id, { kind: "tabs", tabs: ["HSK5"] });
    respondWith([...many(learning, "HSK6", 2), scheduled("HSK5", "예정")]);
    const home = await mount();

    expect(home.chip("HSK5").classList.contains("is-empty")).toBe(true);
    expect(home.startButton().disabled).toBe(true);
    expect(home.startButton().textContent).toBe("오늘 할 것 없음");
    expect(home.sessionCount()).toBe("HSK5 · 오늘 세션 · 0문제");
  });

  it("0문제 칩도 aria-pressed 토글로 선택할 수 있고, 칩 목록은 '학습할 탭' 그룹이다", async () => {
    respondWith([...many(learning, "HSK6", 2), scheduled("HSK5", "예정")]);
    const home = await mount();

    fire(() => home.radio("탭 선택").click());
    const group = home.container.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("학습할 탭");
    expect(home.chip("HSK5").getAttribute("aria-pressed")).toBe("false");

    fire(() => home.chip("HSK5").click());

    expect(home.chip("HSK5").getAttribute("aria-pressed")).toBe("true");
    expect(home.pressedTabs()).toEqual(["HSK6", "HSK5"]);
  });

  it("전체로 바꿨다가 다시 탭 선택을 누르면 이전 칩 선택이 돌아온다", async () => {
    respondWith([...many(learning, "HSK6", 3), ...many(learning, "HSK5", 1), ...many(learning, "교재5과", 1)]);
    const home = await mount();

    fire(() => home.radio("탭 선택").click());
    fire(() => home.chip("교재5과").click());
    expect(home.pressedTabs()).toEqual(["HSK6", "교재5과"]);

    fire(() => home.radio("전체").click());
    expect(home.chipTexts()).toEqual([]);
    expect(home.sessionCount()).toBe("오늘 세션 · 5문제");

    fire(() => home.radio("탭 선택").click());
    expect(home.pressedTabs()).toEqual(["HSK6", "교재5과"]);
    expect(home.sessionCount()).toBe("HSK6 외 1개 탭 · 오늘 세션 · 4문제");
  });

  it("새로고침(재마운트)해도 범위와 칩 선택이 복원된다", async () => {
    respondWith([...many(learning, "HSK6", 3), ...many(learning, "HSK5", 1), ...many(learning, "교재5과", 1)]);
    const first = await mount();
    fire(() => first.radio("탭 선택").click());
    fire(() => first.chip("HSK5").click());
    unmountHome();

    const second = await mount();

    expect(second.radio("탭 선택").getAttribute("aria-checked")).toBe("true");
    expect(second.pressedTabs()).toEqual(["HSK6", "HSK5"]);
    expect(second.sessionCount()).toBe("HSK6 외 1개 탭 · 오늘 세션 · 4문제");
  });

  it("프로필 전환 후 재로그인하면 그 프로필의 범위가 복원되고 다른 프로필과 섞이지 않는다", async () => {
    const other: PublicProfile = { id: "generic-en", name: "영어", modes: ["m1"], contentType: "generic" };
    const hskWords = [...many(learning, "HSK6", 3), ...many(learning, "HSK5", 1)];
    respondWith(hskWords);
    const first = await mount();
    fire(() => first.radio("탭 선택").click());
    expect(first.pressedTabs()).toEqual(["HSK6"]);
    unmountHome();
    clearPassword();

    respondWith([...many(learning, "Unit1", 1), ...many(learning, "Unit2", 2)], { profile: other });
    const second = await mount();
    expect(second.radio("전체").getAttribute("aria-checked")).toBe("true");
    fire(() => second.radio("탭 선택").click());
    expect(second.pressedTabs()).toEqual(["Unit2"]);
    unmountHome();
    clearPassword();

    respondWith(hskWords);
    const third = await mount();
    expect(third.radio("탭 선택").getAttribute("aria-checked")).toBe("true");
    expect(third.pressedTabs()).toEqual(["HSK6"]);
    expect(storedScopes()).toEqual({
      [profile.id]: { kind: "tabs", tabs: ["HSK6"] },
      [other.id]: { kind: "tabs", tabs: ["Unit2"] },
    });
  });

  it("저장된 탭 중 사라진 탭은 조용히 빠지고 저장값도 정리된다", async () => {
    saveStudyScope(profile.id, { kind: "tabs", tabs: ["HSK6", "옛이름", "HSK5"] });
    respondWith([...many(learning, "HSK6", 1), ...many(learning, "HSK5", 1), ...many(learning, "교재5과", 1)]);
    const home = await mount();

    expect(home.container.querySelector(".error-card")).toBeNull();
    expect(home.pressedTabs()).toEqual(["HSK6", "HSK5"]);
    expect(storedScopes()).toEqual({ [profile.id]: { kind: "tabs", tabs: ["HSK6", "HSK5"] } });
  });

  it("저장된 탭이 모두 사라지면 전체로 돌아간다", async () => {
    saveStudyScope(profile.id, { kind: "tabs", tabs: ["옛탭1", "옛탭2"] });
    respondWith([...many(learning, "HSK6", 1), ...many(learning, "HSK5", 1)]);
    const home = await mount();

    expect(home.container.querySelector(".error-card")).toBeNull();
    expect(home.radio("전체").getAttribute("aria-checked")).toBe("true");
    expect(home.sessionCount()).toBe("오늘 세션 · 2문제");
  });

  it("탭이 1개뿐인 프로필은 선택 UI 없이 전체로 동작한다", async () => {
    saveStudyScope(profile.id, { kind: "tabs", tabs: ["HSK6"] });
    respondWith([...many(learning, "HSK6", 2)]);
    const home = await mount();

    expect(home.picker()).toBeNull();
    expect(home.sessionCount()).toBe("오늘 세션 · 2문제");
    expect(home.startQueue()).toHaveLength(2);
  });

  it("로딩·에러 상태에서는 선택 UI가 없다", async () => {
    fetchWordsMock.mockReturnValue(new Promise(() => {}));
    const loading = await mount();
    expect(loading.picker()).toBeNull();
    unmountHome();

    fetchWordsMock.mockRejectedValue(new Error("boom"));
    const failed = await mount();
    expect(failed.container.querySelector(".error-card")).not.toBeNull();
    expect(failed.picker()).toBeNull();
  });

  it("세그먼트는 radiogroup이고 방향키로 선택과 포커스가 함께 이동한다", async () => {
    respondWith([...many(learning, "HSK6", 2), ...many(learning, "HSK5", 1)]);
    const home = await mount();
    const press = (el: HTMLElement, key: string) =>
      fire(() => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

    expect(home.container.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("학습 범위");
    expect(home.radio("전체").tabIndex).toBe(0);
    expect(home.radio("탭 선택").tabIndex).toBe(-1);

    fire(() => home.radio("전체").focus());
    press(home.radio("전체"), "ArrowRight");

    expect(home.radio("탭 선택").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(home.radio("탭 선택"));
    expect(home.radio("탭 선택").tabIndex).toBe(0);
    expect(home.pressedTabs()).toEqual(["HSK6"]);

    press(home.radio("탭 선택"), "ArrowLeft");

    expect(home.radio("전체").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(home.radio("전체"));
    expect(home.chipTexts()).toEqual([]);
  });
});
