import type { NormalizedTtsInput, PronunciationDecision, SynthesisInput } from "./types.ts";

/** 첫 버전은 B열을 제공자에 보내지 않는다. 값은 후속 저장 키 입력으로만 남는다. */
export function decidePronunciation(input: Pick<NormalizedTtsInput, "pinyin">): PronunciationDecision {
  return input.pinyin === null
    ? { status: "absent", reason: null, effectiveHint: null }
    : { status: "ignored", reason: "provider_hint_unsupported", effectiveHint: null };
}

/** 제공자 payload가 text 한 필드임을 타입·실행 값 모두에서 고정한다. */
export function createSynthesisInput(input: Pick<NormalizedTtsInput, "text">): SynthesisInput {
  return { text: input.text };
}
