// @vitest-environment jsdom
//
// 등록 화면 테스트 두 묶음:
// - '문제수' 필드 회귀 (세션 설정 플랜 §3.5, #110) — 현재값 프리필·1~500 클라
//   선검증·저장 성공/실패 표시·등록 배치와의 독립성만 다룬다. 이 묶음에서
//   fetchTabs/registerWords는 빈 목록/미사용 고정 응답.
// - 탭 우선 흐름 (#118·#120) — 탭 섹션이 붙여넣기보다 위, "+ 새 탭"의 "생성" 버튼이
//   POST /api/tabs로 시트에 실제 탭을 만든 뒤(서버 성공 후)에만 선택지 추가·선택
//   전환(#120), 이름 선검증, 로딩 중 재클릭 방지, 실패 시 오류·입력 유지, 확정 전
//   제출 차단, 제출 바디에 createTab 부재를 고정한다.
// - 오류 행 직접 수정 (#127) — 오류 배너 노출/소멸, 모달 편집→저장 시 배치 전체
//   재검증(valid 승격·duplicate 전환·입력 내 중복 동반 해소), '직접수정' 태그,
//   타이핑 중 포커스 유지, 편집 오버레이의 초기화(재확인)/유지(탭 변경), 제출 payload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RegisterScreen from "./RegisterScreen.tsx";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import type { PublicProfile } from "../lib/api.ts";
import type { WordsResponse } from "../lib/wordsApi.ts";

const { fetchWordsMock, fetchTabsMock, createTabMock, registerWordsMock, postSettingsMock } = vi.hoisted(() => ({
  fetchWordsMock: vi.fn(),
  fetchTabsMock: vi.fn(),
  createTabMock: vi.fn(),
  registerWordsMock: vi.fn(),
  postSettingsMock: vi.fn(),
}));

vi.mock("../lib/wordsApi.ts", () => ({ fetchWords: fetchWordsMock }));
vi.mock("../lib/registerApi.ts", () => ({
  fetchTabs: fetchTabsMock,
  createTab: createTabMock,
  registerWords: registerWordsMock,
}));
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
  createTabMock.mockReset();
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
    duplicateBanner: () => container.querySelector(".register-confirm-banner"),
    errorBanner: () => container.querySelector(".register-error-banner"),
    fixButton: () => container.querySelector<HTMLButtonElement>(".register-error-fix-button"),
    modal: () => container.querySelector(".register-modal"),
    modalInputs: () => Array.from(container.querySelectorAll<HTMLInputElement>(".register-modal-input")),
    modalSave: () => container.querySelector<HTMLButtonElement>(".register-modal-save")!,
    modalCancel: () => container.querySelector<HTMLButtonElement>(".register-modal-cancel")!,
    statusCells: () =>
      Array.from(container.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll(".register-status")).map((el) => el.textContent),
      ),
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

describe("RegisterScreen 탭 우선 흐름 (#118·#120)", () => {
  it("등록할 탭 섹션이 스키마 붙여넣기보다 위에 렌더된다", async () => {
    const { tabTrigger, textarea } = setup();
    await flush();

    // DOCUMENT_POSITION_FOLLOWING: textarea가 탭 드롭다운 뒤에 온다.
    expect(tabTrigger().compareDocumentPosition(textarea()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("생성 클릭 시 POST /api/tabs를 호출하고 성공 후 선택지에 추가·선택 상태가 된다", async () => {
    createTabMock.mockResolvedValue({ name: "HSK7", created: true });
    const { tabTrigger, tabTriggerLabel, tabOptions, newTabInput, createButton } = setup();
    await flush();

    // 탭 목록이 비어 있으면 기본이 새 탭 모드 — 이름 입력란이 보인다.
    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    fire(() => createButton()!.click());
    await flush();

    expect(createTabMock).toHaveBeenCalledWith("HSK7");
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
    expect(createTabMock).not.toHaveBeenCalled();
  });

  it("서버 호출 중에는 버튼이 '생성 중…'으로 비활성화되고 재클릭해도 중복 호출되지 않는다", async () => {
    let resolveCreate!: (value: { name: string; created: boolean }) => void;
    createTabMock.mockReturnValue(
      new Promise<{ name: string; created: boolean }>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const { tabTriggerLabel, newTabInput, createButton } = setup();
    await flush();

    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    fire(() => createButton()!.click());

    expect(createButton()!.disabled).toBe(true);
    expect(createButton()!.textContent).toBe("생성 중…");

    fire(() => createButton()!.click());
    expect(createTabMock).toHaveBeenCalledTimes(1);

    fire(() => resolveCreate({ name: "HSK7", created: true }));
    await flush();

    expect(tabTriggerLabel()?.textContent).toBe("HSK7");
  });

  it("생성 실패 시 오류 문구를 보여주고 입력값을 유지하며 선택지는 추가되지 않는다", async () => {
    createTabMock.mockRejectedValue(new Error("탭 생성에 실패했습니다 (HTTP 500)"));
    const { tabTrigger, tabOptions, newTabInput, createButton, newTabErrors } = setup();
    await flush();

    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    fire(() => createButton()!.click());
    await flush();

    // 입력값·새 탭 모드 유지 + Worker 오류 문구 표시. 선택지는 그대로.
    expect(newTabInput()!.value).toBe("HSK7");
    expect(newTabErrors()).toContain("탭 생성에 실패했습니다 (HTTP 500)");
    fire(() => tabTrigger().click());
    expect(tabOptions().map((el) => el.textContent)).toEqual(["+ 새 탭"]);
    fire(() => tabTrigger().click());

    // 입력을 고치면 서버 오류 문구는 사라진다.
    fire(() => setNativeValue(newTabInput()!, "HSK8"));
    expect(newTabErrors()).not.toContain("탭 생성에 실패했습니다 (HTTP 500)");
    expect(createButton()!.disabled).toBe(false);
  });

  it("기존 탭과 같은 이름이면 created: false 멱등 응답으로 그 탭이 선택되고 선택지는 중복되지 않는다", async () => {
    fetchTabsMock.mockResolvedValue(["HSK6"]);
    createTabMock.mockResolvedValue({ name: "HSK6", created: false });
    const { tabTrigger, tabTriggerLabel, tabOptions, newTabInput, createButton } = setup();
    await flush();

    // 첫 탭이 자동 선택된 상태에서 "+ 새 탭"으로 진입한다.
    fire(() => tabTrigger().click());
    fire(() => tabOptions().find((el) => el.textContent === "+ 새 탭")!.click());
    fire(() => setNativeValue(newTabInput()!, "HSK6"));
    fire(() => createButton()!.click());
    await flush();

    expect(tabTriggerLabel()?.textContent).toBe("HSK6");
    expect(newTabInput()).toBeNull();

    fire(() => tabTrigger().click());
    expect(tabOptions().map((el) => el.textContent)).toEqual(["HSK6", "+ 새 탭"]);
  });

  it("생성 직후 그 탭 기준으로 시트 중복이 분류된다", async () => {
    // 시트에는 이미 HSK6 탭에 经济가 있는데 클라 탭 목록 조회가 실패한 상황 —
    // 생성 버튼이 멱등 성공(created: false)으로 그 탭을 선택하면, 중복 대조는
    // allWords의 탭 필터로 즉시 정합해야 한다.
    fetchWordsMock.mockResolvedValue({
      ...wordsResponse,
      words: [
        { tab: "HSK6", hanzi: "经济", pinyin: "jīngjì", meaning: "경제", m1: 0, m2: 0, nextReview: null, interval: null },
      ],
    });
    createTabMock.mockResolvedValue({ name: "HSK6", created: false });
    const { container, textarea, confirmButton, newTabInput, createButton } = setup();
    await flush();

    fire(() => setNativeValue(newTabInput()!, "HSK6"));
    fire(() => createButton()!.click());
    await flush();

    fire(() => setNativeValue(textarea(), VALID_BATCH));
    fire(() => confirmButton().click());

    // 经济가 duplicate로 분류돼 확인 배너가 뜬다.
    expect(container.querySelector(".register-confirm-banner")).not.toBeNull();
    expect(container.textContent).toContain("중복 1건");
  });

  it("생성 확정 전에는 확인을 마쳐도 제출이 불가하고, 확정하면 활성화된다", async () => {
    createTabMock.mockResolvedValue({ name: "HSK7", created: true });
    const { textarea, confirmButton, newTabInput, createButton, submitButton } = setup();
    await flush();

    fire(() => setNativeValue(textarea(), VALID_BATCH));
    fire(() => confirmButton().click());

    // 새 탭 모드(이름 미확정) — 검증 테이블은 떠도 제출은 막힌다.
    expect(submitButton()!.disabled).toBe(true);

    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    fire(() => createButton()!.click());
    await flush();

    expect(submitButton()!.disabled).toBe(false);
  });

  it("생성한 새 탭 제출 바디에도 createTab은 포함되지 않는다", async () => {
    createTabMock.mockResolvedValue({ name: "HSK7", created: true });
    registerWordsMock.mockResolvedValue({ tab: "HSK7", created: false, added: [], skipped: [] });
    const { textarea, confirmButton, newTabInput, createButton, submitButton } = setup();
    await flush();

    fire(() => setNativeValue(newTabInput()!, "HSK7"));
    fire(() => createButton()!.click());
    await flush();
    fire(() => setNativeValue(textarea(), VALID_BATCH));
    fire(() => confirmButton().click());
    fire(() => submitButton()!.click());
    await flush();

    // toHaveBeenCalledWith는 정확 일치 — createTab 키가 없음을 함께 고정한다.
    expect(registerWordsMock).toHaveBeenCalledWith({
      tab: "HSK7",
      words: [{ hanzi: "经济", pinyin: "jīngjì", meaning: "경제" }],
    });
  });

  it("서버 조회 목록에 있는 탭 제출에도 createTab이 포함되지 않는다", async () => {
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

describe("RegisterScreen 오류 행 직접 수정 (#127)", () => {
  // 병음이 한자와 어긋나 blocked가 되는 행 + 정상 행 하나.
  const MIXED_BATCH = JSON.stringify({
    version: 1,
    words: [
      { hanzi: "经济", pinyin: "wrong", meaning: "경제" },
      { hanzi: "社会", pinyin: "shèhuì", meaning: "사회" },
    ],
  });

  function wordIn(tab: string, hanzi: string, pinyin: string, meaning: string) {
    return { tab, hanzi, pinyin, meaning, m1: 0, m2: 0, nextReview: null, interval: null };
  }

  // 탭이 선택된 상태에서 텍스트를 확인까지 마친 화면을 만든다(제출 게이트를 열어 두려고).
  async function confirmed(batch: string, tabs: string[] = ["HSK6"]) {
    fetchTabsMock.mockResolvedValue(tabs);
    const api = setup();
    await flush();
    fire(() => setNativeValue(api.textarea(), batch));
    fire(() => api.confirmButton().click());
    return api;
  }

  it("blocked 행이 있으면 오류 배너가 뜨지만 제출은 막지 않는다", async () => {
    const { errorBanner, fixButton, submitButton } = await confirmed(MIXED_BATCH);

    expect(errorBanner()?.textContent).toContain("오류 1건은 등록되지 않습니다.");
    expect(fixButton()).not.toBeNull();
    // 중복 배너와 달리 오류 배너는 확인 대상이 아니다 — 정상 행이 있으면 그대로 제출 가능.
    expect(submitButton()!.disabled).toBe(false);
  });

  it("blocked 행이 없으면 오류 배너가 뜨지 않는다", async () => {
    const { errorBanner } = await confirmed(VALID_BATCH);

    expect(errorBanner()).toBeNull();
  });

  it("모달에서 값을 고쳐 저장하면 정상으로 승격되고 배너가 사라지며 '직접수정' 태그가 병기된다", async () => {
    const { fixButton, modal, modalInputs, modalSave, errorBanner, statusCells } =
      await confirmed(MIXED_BATCH);

    fire(() => fixButton()!.click());
    // 모달에는 blocked 행만 — 행 하나 × 세 입력.
    expect(modalInputs()).toHaveLength(3);
    expect(modal()?.textContent).toContain("한자와 병음이 일치하지 않습니다");

    fire(() => setNativeValue(modalInputs()[1], "jīngjì"));
    fire(() => modalSave().click());

    expect(modal()).toBeNull();
    expect(errorBanner()).toBeNull();
    // 상태 배지를 대체하지 않고 그 옆에 붙는다. 손대지 않은 둘째 행에는 태그가 없다.
    expect(statusCells()).toEqual([["정상", "직접수정"], ["정상"]]);
  });

  it("취소하면 편집값을 버린다", async () => {
    const { fixButton, modal, modalInputs, modalCancel, errorBanner, statusCells } =
      await confirmed(MIXED_BATCH);

    fire(() => fixButton()!.click());
    fire(() => setNativeValue(modalInputs()[1], "jīngjì"));
    fire(() => modalCancel().click());

    expect(modal()).toBeNull();
    expect(errorBanner()).not.toBeNull();
    expect(statusCells()).toEqual([["오류"], ["정상"]]);
  });

  it("고쳐도 여전히 blocked면 오류로 남고 사유가 갱신된다", async () => {
    const { fixButton, modalInputs, modalSave, errorBanner, container, statusCells } =
      await confirmed(MIXED_BATCH);

    // 병음은 그대로 틀린 채 뜻을 비운다 — 사유가 "빈 값" 쪽으로 늘어난다.
    fire(() => fixButton()!.click());
    fire(() => setNativeValue(modalInputs()[2], ""));
    fire(() => modalSave().click());

    expect(errorBanner()).not.toBeNull();
    expect(container.textContent).toContain("뜻이 비어 있습니다");
    expect(statusCells()).toEqual([["오류", "직접수정"], ["정상"]]);
  });

  it("표제어를 시트에 있는 값으로 고치면 중복으로 전환되고 중복 확인이 다시 요구된다", async () => {
    fetchWordsMock.mockResolvedValue({ ...wordsResponse, words: [wordIn("HSK6", "文化", "wénhuà", "문화")] });
    const { fixButton, modalInputs, modalSave, duplicateBanner, submitButton, statusCells } =
      await confirmed(MIXED_BATCH);

    expect(duplicateBanner()).toBeNull();

    fire(() => fixButton()!.click());
    fire(() => setNativeValue(modalInputs()[0], "文化"));
    fire(() => setNativeValue(modalInputs()[1], "wénhuà"));
    fire(() => modalSave().click());

    expect(statusCells()).toEqual([["중복", "직접수정"], ["정상"]]);
    // 중복 서명이 생겼으니 확인 전까지 제출이 막힌다.
    expect(duplicateBanner()).not.toBeNull();
    expect(submitButton()!.disabled).toBe(true);
  });

  it("입력 내 중복 두 행 중 하나만 고치면 손대지 않은 짝 행의 오류도 함께 풀린다", async () => {
    const duplicatedBatch = JSON.stringify({
      version: 1,
      words: [
        { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
        { hanzi: "经济", pinyin: "jīngjì", meaning: "경제(중복)" },
      ],
    });
    const { fixButton, modalInputs, modalSave, errorBanner, statusCells } = await confirmed(duplicatedBatch);

    expect(statusCells()).toEqual([["오류"], ["오류"]]);

    // 모달에는 blocked 두 행이 모두 뜬다 — 첫 행만 다른 한자로 고친다.
    fire(() => fixButton()!.click());
    expect(modalInputs()).toHaveLength(6);
    fire(() => setNativeValue(modalInputs()[0], "文化"));
    fire(() => setNativeValue(modalInputs()[1], "wénhuà"));
    fire(() => setNativeValue(modalInputs()[2], "문화"));
    fire(() => modalSave().click());

    expect(errorBanner()).toBeNull();
    // 태그는 실제로 고친 행에만 — 짝 행은 손대지 않았지만 중복이 풀려 정상이 된다.
    expect(statusCells()).toEqual([["정상", "직접수정"], ["정상"]]);
  });

  it("모달 입력은 타이핑 중 포커스를 유지한다 (index 고정 key)", async () => {
    const { fixButton, modalInputs } = await confirmed(MIXED_BATCH);

    fire(() => fixButton()!.click());
    const headword = modalInputs()[0];
    fire(() => headword.focus());
    fire(() => setNativeValue(headword, "文"));

    // key에 값이 섞이면 input이 re-mount되어 포커스가 body로 떨어진다.
    expect(modalInputs()[0]).toBe(headword);
    expect(document.activeElement).toBe(headword);
    expect(modalInputs()[0].value).toBe("文");
  });

  it("텍스트를 고쳐 재확인하면 편집 오버레이가 초기화된다", async () => {
    const { fixButton, modalInputs, modalSave, textarea, confirmButton, statusCells } =
      await confirmed(MIXED_BATCH);

    fire(() => fixButton()!.click());
    fire(() => setNativeValue(modalInputs()[1], "jīngjì"));
    fire(() => modalSave().click());
    expect(statusCells()).toEqual([["정상", "직접수정"], ["정상"]]);

    // 분류 결과가 같아지는 변경(공백 추가)이라도 텍스트가 달라졌으면 오버레이는 버린다.
    fire(() => setNativeValue(textarea(), `${MIXED_BATCH} `));
    fire(() => confirmButton().click());

    expect(statusCells()).toEqual([["오류"], ["정상"]]);
  });

  it("탭만 바꾸면 편집 오버레이가 유지된다", async () => {
    const { fixButton, modalInputs, modalSave, tabTrigger, tabOptions, statusCells } = await confirmed(
      MIXED_BATCH,
      ["HSK6", "HSK7"],
    );

    fire(() => fixButton()!.click());
    fire(() => setNativeValue(modalInputs()[1], "jīngjì"));
    fire(() => modalSave().click());

    fire(() => tabTrigger().click());
    fire(() => tabOptions().find((el) => el.textContent === "HSK7")!.click());

    // 탭 변경은 텍스트 게이트 밖 — 분류만 다시 돌고 편집값·태그는 살아 있다.
    expect(statusCells()).toEqual([["정상", "직접수정"], ["정상"]]);
  });

  it("전 행이 blocked라 막혀 있던 제출이 수정으로 valid가 생기면 활성화된다", async () => {
    const allBlocked = JSON.stringify({ version: 1, words: [{ hanzi: "经济", pinyin: "wrong", meaning: "경제" }] });
    const { submitButton, fixButton, modalInputs, modalSave } = await confirmed(allBlocked);

    expect(submitButton()!.disabled).toBe(true);

    fire(() => fixButton()!.click());
    fire(() => setNativeValue(modalInputs()[1], "jīngjì"));
    fire(() => modalSave().click());

    expect(submitButton()!.disabled).toBe(false);
  });

  it("제출 payload는 편집 후 값 기준이고 blocked 행은 그대로 제외된다", async () => {
    registerWordsMock.mockResolvedValue({ tab: "HSK6", created: false, added: [], skipped: [] });
    const batch = JSON.stringify({
      version: 1,
      words: [
        { hanzi: "经济", pinyin: "wrong", meaning: "경제" },
        { hanzi: "社会", pinyin: "shèhuì", meaning: "사회" },
        { hanzi: "文化", pinyin: "nope", meaning: "문화" },
      ],
    });
    const { fixButton, modalInputs, modalSave, submitButton } = await confirmed(batch);

    // 첫 blocked 행만 고치고 둘째(文化)는 오류로 남긴다.
    fire(() => fixButton()!.click());
    fire(() => setNativeValue(modalInputs()[1], "jīngjì"));
    fire(() => modalSave().click());
    fire(() => submitButton()!.click());
    await flush();

    // 정확 일치 — '직접수정'은 표시 전용이라 와이어에 실리지 않는다.
    expect(registerWordsMock).toHaveBeenCalledWith({
      tab: "HSK6",
      words: [
        { hanzi: "经济", pinyin: "jīngjì", meaning: "경제" },
        { hanzi: "社会", pinyin: "shèhuì", meaning: "사회" },
      ],
    });
  });
});
