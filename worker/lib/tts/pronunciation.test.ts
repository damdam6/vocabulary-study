import { describe, expect, it } from "vitest";
import { createSynthesisInput, decidePronunciation } from "./pronunciation.ts";

describe("병음 미적용 정책", () => {
  it("없는 병음은 absent이고 값이 있으면 의미와 관계없이 ignored다", () => {
    expect(decidePronunciation({ pinyin: null })).toEqual({ status: "absent", reason: null, effectiveHint: null });
    expect(decidePronunciation({ pinyin: "xíng" })).toEqual({ status: "ignored", reason: "provider_hint_unsupported", effectiveHint: null });
    expect(decidePronunciation({ pinyin: "háng" })).toEqual({ status: "ignored", reason: "provider_hint_unsupported", effectiveHint: null });
    expect(decidePronunciation({ pinyin: "not pinyin" }).status).toBe("ignored");
  });

  it("제공자 입력은 같은 A열 text 한 필드만 가진다", () => {
    expect(createSynthesisInput({ text: "经济" })).toEqual({ text: "经济" });
    expect(createSynthesisInput({ text: "行" })).toEqual({ text: "行" });
    const sentence = "今天下午三点，我们  一起去图书馆学习。价格是3.5元。";
    expect(createSynthesisInput({ text: sentence })).toEqual({ text: sentence });
    expect(decidePronunciation({ pinyin: "jīntiān xiàwǔ sān diǎn" })).toEqual({
      status: "ignored", reason: "provider_hint_unsupported", effectiveHint: null,
    });
  });
});
