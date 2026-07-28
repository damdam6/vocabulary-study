// jsdom 환경 전용 렌더 헬퍼 (#105) — 이 레포의 첫 DOM 테스트를 위한 최소 도구.
//
// @testing-library 대신 react-dom/client + React 19의 act만 쓴다: 필요한 동작이
// "마운트 · 조작 · 언마운트" 셋뿐이라 이 파일 하나로 충분하고, 이 레포는 기능 하나에
// 의존성을 늘리지 않는 관행을 지켜 왔다(아이콘 라이브러리 기각 —
// docs/plans/session-limit-and-home-utils.md §8). 추가한 devDependency는 jsdom 하나.
//
// 쓰는 쪽 테스트 파일 최상단에 `// @vitest-environment jsdom` 도크블록이 필요하다.
// vitest.config.ts의 기본 환경은 node 그대로여서 순수 함수 테스트는 영향을 받지 않는다.
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

interface RenderResult {
  container: HTMLElement
  unmount: () => void
}

export function renderComponent(element: ReactElement): RenderResult {
  // React 19의 act는 이 전역 플래그가 켜져 있어야 경고 없이 동작한다.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

// 클릭·키 입력처럼 상태를 바꾸는 조작은 act로 감싸야 React가 리렌더를 flush 한다.
export function fire(action: () => void) {
  act(() => {
    action();
  });
}

// 마운트 중 시작된 비동기 작업(fetch 등)의 후속 setState까지 흘려보낸다.
export async function flush() {
  await act(async () => {});
}
