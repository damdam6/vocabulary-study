// @vitest-environment jsdom
//
// 등록 화면 상단 '문제수' 필드 회귀 테스트 (세션 설정 플랜 §3.5, #110) — 현재값
// 프리필·1~500 클라 선검증·저장 성공/실패 표시·등록 배치와의 독립성·포커스 배선만
// 다룬다. 붙여넣기→검증→탭 선택→제출 흐름 자체는 이 이슈의 대상이 아니라
// fetchTabs/registerWords는 항상 빈 목록/미사용으로 고정 응답한다.
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
  };
}

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
