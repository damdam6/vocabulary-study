import { describe, expect, it } from "vitest";
import {
  TTS_ERROR_CODES,
  TTS_MAX_TEXT_LENGTH,
  type PronunciationBinding,
  type TtsAudioOutput,
  type TtsBlobCache,
  type TtsTransport,
} from "./ttsTypes.ts";
import { pronunciationIdleFixture, ttsCapabilityEnabledFixture, ttsGeneratedAudioFixture, ttsTimeoutFixture } from "./ttsFixtures.ts";

describe("브라우저 TTS 계약", () => {
  it("서버 capability와 HTTP 진단 fixture를 브라우저에서만 소비한다", () => {
    expect(ttsCapabilityEnabledFixture).toEqual({ enabled: true, revision: "tts-v1", maxTextLength: TTS_MAX_TEXT_LENGTH });
    expect(ttsGeneratedAudioFixture).toMatchObject({ source: "GENERATED", storage: "UNCONFIRMED", pronunciation: "ignored" });
    expect(ttsTimeoutFixture).toEqual({ kind: "timeout" });
    expect(TTS_ERROR_CODES).toContain("tts_not_configured");
  });

  it("후속 구현이 사용할 전송·출력·캐시·binding 포트의 최소 형태를 고정한다", () => {
    const transport: TtsTransport = async () => ttsGeneratedAudioFixture;
    const output: TtsAudioOutput = { play: async () => ({ status: "started" }), stop() {}, dispose() {}, subscribe: () => () => {} };
    const cache: TtsBlobCache = { get: () => undefined, set: () => ({ stored: false }), pin() {}, unpin() {}, clear() {}, dispose() {} };
    const binding: PronunciationBinding = { snapshot: pronunciationIdleFixture, prepare() {}, reveal() {}, replay() {} };
    expect([transport, output, cache, binding]).toHaveLength(4);
  });
});
