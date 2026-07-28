// @vitest-environment jsdom
//
// 등록 화면 테스트 두 묶음:
// - '문제수' 필드 회귀 (세션 설정 플랜 §3.5, #110) — 현재값 프리필·1~500 클라
//   선검증·저장 성공/실패 표시·등록 배치와의 독립성만 다룬다. 이 묶음에서
//   fetchTabs/registerWords는 빈 목록/미사용 고정 응답.
// - 탭 우선 흐름 (#118) — 탭 섹션이 붙여넣기보다 위, "+ 새 탭"의 "생성" 버튼
//   확정(선택지 추가+선택 전환·이름 선검증·기존 탭 중복 시 그 탭 선택), 확정 전
//   제출 차단, 제출 바디의 createTab 계산(서버 조회 목록 기준)을 고정한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RegisterScreen from "./RegisterScreen.tsx";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import type { PublicProfile } from "../lib/api.ts";
import type { WordsResponse } from "../lib/wordsApi.ts";

const { fetchWordsMock, fetchTabsMock, registerWordsMock, postSettingsMock } = vi.hoisted(() => ({
  fetchWordsMock: vi.fn(),
  fetchTabsMock: vi.fn(),
  registerWordsMock: vi.fn(),
  postSettingsMock: vi.fn(),
}));

vi.mock("../lib/wordsApi.ts", () => ({ fetchWords: fetchWordsMock }));
vi.mock("../lib/registerApi.ts", () => ({ fetchTabs: fetchTabsMock, registerWords: registerWordsMock }));
vi.mock("../lib/api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api.ts")>();
  return { ...actual, postSettings: postSettingsMock };
});

const profile: PublicProfile = { id: "hsk6", name: "HSK 6급", modes: ["m1", "m2"], contentType: "zh" };
const wordsResponse: WordsResponse = { profile, words: [], settings: { sessionLimit: 30 } };

// React 19의 controlled input은 인스턴스에 자체 value 세터를 얹어 "값이 바뀌었는지"를
// 추적한다 — el.value = x로 직접 대입하면 이 추적을 건너뛰어 이후 dispatchEvent가
// onChange를 못 깨운다. 네이티브 프로토타입의 세터를 직접 호출해야 한다(React 테스트
// 커뮤니티에 알려진 우회법 — react-dom/client + 순수 DOM 이벤트 조합의 불가피한 대가).
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

// jsdom은 scrollIntoView를 구현하지 않는다 — Dropdown이 열릴 때 활성 옵션을
// 스크롤하는 효과(Dropdown.tsx)가 던지지 않게 no-op으로 채운다.
HTMLElement.prototype.scrollIntoView = () => {};

let unmountCurrent: (() => void) | null = null;

beforeEach(() => {
  fetchWordsMock.mockReset();
  fetchWordsMock.mockResolvedValue(wordsResponse);
  fetchTabsMock.mockReset();
  fetchTabsMock.mockResolvedValue([]);
  registerWordsMock.mockReset();
  postSettingsMock.mockReset();
});

afterEach(() => {
  unmountCurrent?.();
  unmountCurrent = null;
  vi.restoreAllMocks();
});

function setup() {
  const onGoHome = vi.fn();
  const { container, unmount } = renderComponent(<RegisterScreen contentType="zh" onGoHome={onGoHome} />);
  unmountCurrent = unmount;

  return {
    container,
    onGoHome,
    limitInput: () => container.querySelector<HTMLInputElement>("#register-limit-input")!,
    saveButton: () => container.querySelector<HTMLButtonElement>(".register-limit-save-button")!,
    limitFieldErrors: () =>
      Array.from(container.querySelectorAll(".register-limit-field .register-error")).map((el) => el.textContent),
    successMessage: () => container.querySelector(".register-limit-success"),
    textarea: () => container.querySelector<HTMLTextAreaElement>("#register-textarea")!,
    confirmButton: () => container.querySelector<HTMLButtonElement>(".register-confirm-button")!,
    tabTrigger: () => container.querySelector<HTMLButtonElement>("#register-tab-select")!,
    tabTriggerLabel: () => container.querySelector(".dropdown-trigger-label"),
    tabOptions: () => Array.from(container.querySelectorAll<HTMLLIElement>('[role="option"]')),
    newTabInput: () => container.querySelector<HTMLInputElement>(".register-new-tab-input"),
    createButton: () => container.querySelector<HTMLButtonElement>(".register-new-tab-create-button"),
    newTabErrors: () =>
      Array.from(container.querySelectorAll(".register-field .register-error")).map((el) => el.textContent),
    submitButton: () => container.querySelector<HTMLButtonElement>(".primary-button"),
  };
}

const VALID_BATCH = '{"version":1,"words":[{"hanzi":"经济","pinyin":"jīngjì","meaning":"경제"}]}';

describe("RegisterScreen 문제수 필드", () => {
  it("fetchWords의 settings.sessionLimit을 입력란 현재값으로 프리필한다", async () => {
    const { limitInput } = setup();
    await flush();

    expect(limitInput().value).toBe("30");
  });

  it("저장하면 postSettings를 호출하고 성공 시 반영값과 성공 문구를 보여준다", async () => {
    postSettingsMock.mockResolvedValue({ sessionLimit: 45 });
    const { limitInput, saveButton, successMessage } = setup();
    await flush();

    fire(() => setNativeValue(limitInput(), "45"));
    fire(() => saveButton().click());
    await flush();

    expect(postSettingsMock).toHaveBeenCalledWith(45);
    expect(limitInput().value).toBe("45");
    expect(successMessage()?.textContent).toBe("저장되었습니다");
  });

  it.each([
    ["0", "0"],
    ["501", "501"],
    // type="number" 입력란이라 "abc" 같은 순수 문자는 브라우저(jsdom도 동일)가 자체
    // 필터링한다 — 이 입력 타입에서 실제로 들어올 수 있는 비정수 값은 소수점이다.
    ["1.5(비정수)", "1.5"],
  ])("경계값 %s 입력 시 저장 버튼이 비활성화되고 입력값은 유지된다", async (_label, raw) => {
    const { limitInput, saveButton, limitFieldErrors } = setup();
    await flush();

    fire(() => setNativeValue(limitInput(), raw));

    expect(limitInput().value).toBe(raw);
    expect(saveButton().disabled).toBe(true);
    expect(limitFieldErrors().length).toBeGreaterThan(0);
    expect(postSettingsMock).not.toHaveBeenCalled();
  });

  it("입력을 비우면 저장 버튼이 비활성화되고 오류 문구가 뜬다", async () => {
    const { limitInput, saveButton, limitFieldErrors } = setup();
    await flush();

    fire(() => setNativeValue(limitInput(), ""));

    expect(saveButton().disabled).toBe(true);
    expect(limitFieldErrors().length).toBeGreaterThan(0);
  });

  it("저장 실패 시 Worker의 오류 문구를 보여주고 입력값을 유지한다", async () => {
    postSettingsMock.mockRejectedValue(new Error("sessionLimit은 1~500 사이의 정수여야 합니다"));
    const { limitInput, saveButton, limitFieldErrors, successMessage } = setup();
    await flush();

    fire(() => setNativeValue(limitInput(), "45"));
    fire(() => saveButton().click());
    await flush();

    expect(limitFieldErrors()).toEqual(["sessionLimit은 1~500 사이의 정수여야 합니다"]);
    expect(limitInput().value).toBe("45");
    expect(successMessage()).toBeNull();
  });

  it("문제수 필드를 수정·저장해도 등록 배치(텍스트·확인 버튼) 상태에 영향이 없다", async () => {
    postSettingsMock.mockResolvedValue({ sessionLimit: 45 });
    const { limitInput, saveButton, textarea, confirmButton } = setup();
    await flush();

    fire(() => setNativeValue(textarea(), '{"version":1,"words":[]}'));
    expect(confirmButton().disabled).toBe(false);

    fire(() => setNativeValue(limitInput(), "45"));
    fire(() => saveButton().click());
    await flush();

    // 문제수 저장이 끝난 뒤에도 붙여넣은 텍스트·확인 가능 상태가 그대로다.
    expect(textarea().value).toBe('{"version":1,"words":[]}');
    expect(confirmButton().disabled).toBe(false);
  });
});

describe("RegisterScreen 탭 우선 흐름 (#118)", () => {
  it("등록할 탭 섹션이 스키마 붙여넣기보다 위에 렌더된다", async () => {
    const { tabTrigger, textarea } = setup();
    await flush();

    // DOCUMENT_POSITION_FOLLOWING: textarea가 탭 드롭다운 뒤에 온다.
    expect(tabTrigger().compareDocumentPosition(textarea()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("생성 클릭 시 이름이 선택지에 추가되고 그 탭이 선택 상태가 된다", async () => {
    const { tabTrigger, tabTriggerLabel, tabOptions, newTabInput, createButton } = setup();
    await flush();

    // 탭 목록이 비어 있으면 기본이 새 탭 모드 — 이름 입력란이 보인다.
    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    fire(() => createButton()!.click());

    expect(tabTriggerLabel()?.textContent).toBe("HSK7");
    expect(newTabInput()).toBeNull();

    fire(() => tabTrigger().click());
    expect(tabOptions().map((el) => el.textContent)).toEqual(["HSK7", "+ 새 탭"]);
  });

  it("빈 이름·_ 시작이면 생성 버튼이 비활성화되고 유효해지면 풀린다", async () => {
    const { newTabInput, createButton, newTabErrors } = setup();
    await flush();

    expect(createButton()!.disabled).toBe(true);

    fire(() => setNativeValue(newTabInput()!, "_숨김"));
    expect(createButton()!.disabled).toBe(true);
    expect(newTabErrors()).toContain("탭 이름은 _로 시작할 수 없습니다");

    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    expect(createButton()!.disabled).toBe(false);
  });

  it("기존 탭과 같은 이름을 생성하면 그 탭이 선택되고 선택지는 중복되지 않는다", async () => {
    fetchTabsMock.mockResolvedValue(["HSK6"]);
    const { tabTrigger, tabTriggerLabel, tabOptions, newTabInput, createButton } = setup();
    await flush();

    // 첫 탭이 자동 선택된 상태에서 "+ 새 탭"으로 진입한다.
    fire(() => tabTrigger().click());
    fire(() => tabOptions().find((el) => el.textContent === "+ 새 탭")!.click());
    fire(() => setNativeValue(newTabInput()!, "HSK6"));
    fire(() => createButton()!.click());

    expect(tabTriggerLabel()?.textContent).toBe("HSK6");
    expect(newTabInput()).toBeNull();

    fire(() => tabTrigger().click());
    expect(tabOptions().map((el) => el.textContent)).toEqual(["HSK6", "+ 새 탭"]);
  });

  it("생성 확정 전에는 확인을 마쳐도 제출이 불가하고, 확정하면 활성화된다", async () => {
    const { textarea, confirmButton, newTabInput, createButton, submitButton } = setup();
    await flush();

    fire(() => setNativeValue(textarea(), VALID_BATCH));
    fire(() => confirmButton().click());

    // 새 탭 모드(이름 미확정) — 검증 테이블은 떠도 제출은 막힌다.
    expect(submitButton()!.disabled).toBe(true);

    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    fire(() => createButton()!.click());

    expect(submitButton()!.disabled).toBe(false);
  });

  it("로컬 생성 탭 제출에는 createTab: true가 포함된다", async () => {
    registerWordsMock.mockResolvedValue({ tab: "HSK7", created: true, added: [], skipped: [] });
    const { textarea, confirmButton, newTabInput, createButton, submitButton } = setup();
    await flush();

    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    fire(() => createButton()!.click());
    fire(() => setNativeValue(textarea(), VALID_BATCH));
    fire(() => confirmButton().click());
    fire(() => submitButton()!.click());
    await flush();

    expect(registerWordsMock).toHaveBeenCalledWith({
      tab: "HSK7",
      createTab: true,
      words: [{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }],
    });
  });

  it("서버 조회 목록에 있는 탭 제출에는 createTab이 포함되지 않는다", async () => {
    fetchTabsMock.mockResolvedValue(["HSK6"]);
    registerWordsMock.mockResolvedValue({ tab: "HSK6", created: false, added: [], skipped: [] });
    const { textarea, confirmButton, submitButton } = setup();
    await flush();

    fire(() => setNativeValue(textarea(), VALID_BATCH));
    fire(() => confirmButton().click());
    fire(() => submitButton()!.click());
    await flush();

    expect(registerWordsMock).toHaveBeenCalledWith({
      tab: "HSK6",
      words: [{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }],
    });
  });
});
