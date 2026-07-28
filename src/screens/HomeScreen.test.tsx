// @vitest-environment jsdom
//
// 홈 화면의 진입 액션 배치 회귀 테스트 (#105) — 유틸 바가 헤더에 있고, 옛 하단 저강조
// 링크 2개는 사라졌으며, 유틸 바의 액션이 App에서 내려온 prop까지 실제로 이어지는지.
// 수정 버튼은 메뉴 없이 즉시 등록 화면으로 이동한다(#112). 세션 큐·현황 집계 로직은
// 이 작업의 대상이 아니라 fetchWords만 고정 응답으로 대체한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeScreen from "./HomeScreen.tsx";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import type { PublicProfile, WordEntry } from "../lib/api.ts";
import type { WordsResponse } from "../lib/wordsApi.ts";

const { fetchWordsMock } = vi.hoisted(() => ({ fetchWordsMock: vi.fn() }));

vi.mock("../lib/wordsApi.ts", () => ({ fetchWords: fetchWordsMock }));

const profile: PublicProfile = { id: "hsk6", name: "HSK 6급", modes: ["m1", "m2"], contentType: "zh" };
const wordsResponse: WordsResponse = { profile, words: [], settings: { sessionLimit: 60 } };

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

describe("세션 시작 — limit 스레딩 (#113)", () => {
  const learningWord: WordEntry = {
    tab: "HSK6",
    hanzi: "经济",
    pinyin: "jīngjì",
    meaning: "경제",
    m1: 1,
    m2: 0,
    nextReview: null,
    interval: null,
  };

  it("학습 시작이 큐와 함께 시트 설정 문제 수를 올린다 — 재삽입 상한이 60으로 굳지 않도록", async () => {
    // 상한이 큐 구성에만 반영되고 onStart에서 누락되면 학습 화면이 기본 60으로 되돌아간다.
    fetchWordsMock.mockResolvedValue({
      profile,
      words: [learningWord],
      settings: { sessionLimit: 35 },
    } satisfies WordsResponse);
    const { onStart, startButton } = setup();
    await flush();

    fire(() => startButton().click());

    expect(onStart).toHaveBeenCalledTimes(1);
    const [queue, limit] = onStart.mock.calls[0] as [unknown[], number];
    expect(limit).toBe(35);
    expect(queue).toHaveLength(1);
  });
});
