import { describe, expect, it } from "vitest";
import { hanziFontSize } from "./hanziSize";

describe("hanziFontSize", () => {
  it("2자 이하는 84px", () => {
    expect(hanziFontSize("爱")).toBe(84);
    expect(hanziFontSize("你好")).toBe(84);
  });

  it("3자는 64px", () => {
    expect(hanziFontSize("图书馆")).toBe(64);
  });

  it("4자 이상은 52px", () => {
    expect(hanziFontSize("乱七八糟")).toBe(52);
    expect(hanziFontSize("百闻不如一见")).toBe(52);
  });

  it("서로게이트 쌍 확장 한자도 코드포인트로 센다", () => {
    // "𠮷"(U+20BB7)은 length로는 2 — 2자면 84px이어야 한다.
    expect(hanziFontSize("𠮷𠮷")).toBe(84);
  });
});
