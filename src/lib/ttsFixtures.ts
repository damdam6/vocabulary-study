import type { PronunciationSnapshot, TtsAudioResponse, TtsCapability, TtsTransportFailure } from "./ttsTypes.ts";

/** 네트워크 없이 계약 소비자를 테스트하는 진단 fixture. Blob은 유효 MP3라고 주장하지 않는다. */
export const ttsCapabilityEnabledFixture: TtsCapability = { enabled: true, revision: "tts-v1", maxTextLength: 200 };
export const ttsCapabilityDisabledFixture: TtsCapability = { enabled: false };
export const ttsGeneratedAudioFixture: TtsAudioResponse = {
  audio: new Blob(["fixture"], { type: "application/octet-stream" }),
  source: "GENERATED",
  storage: "UNCONFIRMED",
  pronunciation: "ignored",
  revision: "tts-v1",
};
export const ttsTimeoutFixture: TtsTransportFailure = { kind: "timeout" };
export const pronunciationIdleFixture: PronunciationSnapshot = {
  status: "idle", questionId: null, enabled: true, inputReason: null, message: null,
};
