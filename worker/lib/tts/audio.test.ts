import { describe, expect, it } from "vitest";
import { validateMp3 } from "./audio.ts";
import { createId3Mp3Fixture, createMp3Fixture } from "./fixtures/mp3.ts";
import { MAX_TTS_AUDIO_BYTES } from "./types.ts";

describe("validateMp3", () => {
  it("accepts complete Layer III frames and bounded ID3 metadata", () => {
    expect(validateMp3(createMp3Fixture(1), "audio/mpeg")).toBe(true);
    expect(validateMp3(createMp3Fixture(3), " Audio/MPEG; charset=binary ")).toBe(true);
    expect(validateMp3(createId3Mp3Fixture(), "audio/mpeg")).toBe(true);
  });

  it.each([
    ["empty", new Uint8Array()],
    ["html", new TextEncoder().encode("<html>not audio</html>")],
    ["json", new TextEncoder().encode('{"error":true}')],
    ["wav", new TextEncoder().encode("RIFF....WAVE")],
    ["ID3 only", new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])],
    ["oversized ID3", new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f])],
  ])("rejects %s bytes", (_name, bytes) => {
    expect(validateMp3(bytes, "audio/mpeg")).toBe(false);
  });

  it("rejects invalid MIME, oversize, reserved/free headers, truncation, and trailing garbage", () => {
    expect(validateMp3(createMp3Fixture(), "audio/mp3")).toBe(false);
    expect(validateMp3(new Uint8Array(MAX_TTS_AUDIO_BYTES + 1), "audio/mpeg")).toBe(false);
    for (const third of [0x04, 0xf4, 0xcc]) {
      const bytes = createMp3Fixture(1);
      bytes[2] = third;
      expect(validateMp3(bytes, "audio/mpeg")).toBe(false);
    }
    expect(validateMp3(createMp3Fixture(1).subarray(0, 383), "audio/mpeg")).toBe(false);
    const trailing = new Uint8Array(385);
    trailing.set(createMp3Fixture(1));
    expect(validateMp3(trailing, "audio/mpeg")).toBe(false);
  });
});
