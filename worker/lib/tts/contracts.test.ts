import { describe, expect, it } from "vitest";
import { MAX_TTS_TEXT_LENGTH, TTS_ERROR_RESPONSES, TTS_RESPONSE_HEADERS, type TtsCapability as WorkerCapability } from "./types.ts";
import { TTS_ERROR_CODES, TTS_MAX_TEXT_LENGTH, type TtsAudioResponse, type TtsCapability } from "../../../src/lib/ttsTypes.ts";

describe("Worker와 브라우저 공개 계약", () => {
  it("오류 코드·상한·응답 헤더가 하나의 계약을 가리킨다", () => {
    expect(TTS_MAX_TEXT_LENGTH).toBe(MAX_TTS_TEXT_LENGTH);
    expect(TTS_ERROR_CODES).toEqual(Object.keys(TTS_ERROR_RESPONSES));
    expect(TTS_RESPONSE_HEADERS).toMatchObject({ cacheControl: "private, no-store", contentType: "audio/mpeg", contentTypeOptions: "nosniff" });
  });

  it("capability와 진단 조합을 타입 수준에서 양쪽이 소비할 수 있다", () => {
    const workerEnabled: WorkerCapability = { enabled: true, revision: "tts-v1", maxTextLength: 200 };
    const browserEnabled: TtsCapability = workerEnabled;
    const response: TtsAudioResponse = { audio: new Blob(), source: "GENERATED", storage: "UNCONFIRMED", pronunciation: "ignored", revision: browserEnabled.revision };
    expect(response.storage).toBe("UNCONFIRMED");
  });
});
