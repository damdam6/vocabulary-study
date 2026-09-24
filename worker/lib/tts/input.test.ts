import { describe, expect, it } from "vitest";
import { MAX_TTS_REQUEST_BYTES } from "./types.ts";
import { normalizeTtsRequest, readTtsRequest, TtsInputError } from "./input.ts";

function invalid(value: unknown): void {
  expect(() => normalizeTtsRequest(value)).toThrow(TtsInputError);
}

describe("normalizeTtsRequest", () => {
  it("A열은 NFC·줄바꿈·trim을 정규화하고 문장부호·숫자·내부 공백을 보존한다", () => {
    expect(normalizeTtsRequest({ text: " \r\n你，好 123\r " })).toEqual({ text: "你，好 123", pinyin: null });
    expect(normalizeTtsRequest({ text: "e\u0301中" }).text).toBe("é中");
    const sentence = "今天下午三点，我们  一起去图书馆学习。价格是3.5元；增长了５％！AI也能读。";
    expect(normalizeTtsRequest({ text: `  ${sentence}  ` }).text).toBe(sentence);
  });

  it("1~200 코드 포인트와 확장 한자는 허용하고 공백·한자 없음·201자는 거부한다", () => {
    expect(normalizeTtsRequest({ text: "𠀀" })).toEqual({ text: "𠀀", pinyin: null });
    expect(normalizeTtsRequest({ text: "中".repeat(200) }).text).toHaveLength(200);
    const twoHundredCodePoints = `𠀀${"中".repeat(199)}`;
    expect(twoHundredCodePoints.length).toBe(201);
    expect(Array.from(normalizeTtsRequest({ text: twoHundredCodePoints }).text)).toHaveLength(200);
    invalid({ text: "" });
    invalid({ text: " \n\t " });
    invalid({ text: "only latin 123" });
    invalid({ text: "中".repeat(201) });
    invalid({ text: `${twoHundredCodePoints}中` });
  });

  it("탭·LF만 내부 C0로 허용하고 NUL·VT·FF 등은 trim 전에 거부한다", () => {
    expect(normalizeTtsRequest({ text: "中\t文\n字" }).text).toBe("中\t文\n字");
    for (const character of ["\0", "\v", "\f", "\u0001", "\u001f"]) {
      invalid({ text: `中${character}` });
      invalid({ text: `中${character} ` });
    }
  });

  it("객체 allowlist와 B열 형식을 검사하고 B열은 의미와 무관하게 보존한다", () => {
    expect(normalizeTtsRequest({ text: "行", pinyin: " ha\u0301ng \r\n" })).toEqual({ text: "行", pinyin: "háng" });
    expect(normalizeTtsRequest({ text: "行", pinyin: "  " }).pinyin).toBeNull();
    expect(normalizeTtsRequest({ text: "行", pinyin: "x".repeat(1000) }).pinyin).toHaveLength(1000);
    for (const value of [null, [], "text", 1, { text: "中", pinyin: null }, { text: "中", pinyin: 1 }, { text: "中", provider: "qwen" }, { text: "中", ssml: "x" }, { text: "中", pinyin: "x".repeat(1001) }]) invalid(value);
  });
});

describe("readTtsRequest", () => {
  it("정확히 16KiB인 유효 JSON은 허용한다", async () => {
    const json = JSON.stringify({ text: "中" });
    const padding = " ".repeat(MAX_TTS_REQUEST_BYTES - new TextEncoder().encode(json).byteLength);
    const body = `${json}${padding}`;
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_TTS_REQUEST_BYTES);
    await expect(readTtsRequest(new Request("https://example.test", { method: "POST", body }))).resolves.toEqual({ text: "中", pinyin: null });
  });

  it("Content-Length가 없거나 작게 위조되어도 실제 스트림 바이트를 제한한다", async () => {
    const tooLarge = JSON.stringify({ text: "中", pinyin: "x".repeat(MAX_TTS_REQUEST_BYTES) });
    await expect(readTtsRequest(new Request("https://example.test", { method: "POST", body: tooLarge }))).rejects.toMatchObject({ code: "tts_request_too_large" });
    await expect(readTtsRequest(new Request("https://example.test", { method: "POST", body: tooLarge, headers: { "Content-Length": "2" } }))).rejects.toMatchObject({ code: "tts_request_too_large" });
    await expect(readTtsRequest(new Request("https://example.test", { method: "POST", body: JSON.stringify({ text: "中" }), headers: { "Content-Length": String(MAX_TTS_REQUEST_BYTES + 1) } }))).rejects.toMatchObject({ code: "tts_request_too_large" });
  });

  it("여러 chunk와 UTF-8 문자 경계도 원문을 보존하며 reader lock을 해제한다", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ text: "你好", pinyin: "nǐ hǎo" }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 11));
        controller.enqueue(bytes.slice(11, 14));
        controller.enqueue(bytes.slice(14));
        controller.close();
      },
    });
    const request = new Request(
      "https://example.test",
      { method: "POST", body: stream, duplex: "half" } as unknown as RequestInit,
    );
    await expect(readTtsRequest(request)).resolves.toEqual({ text: "你好", pinyin: "nǐ hǎo" });
    expect(request.body?.locked).toBe(false);
  });

  it("빈 body와 깨진 JSON은 고정 오류로 정규화한다", async () => {
    await expect(readTtsRequest(new Request("https://example.test", { method: "POST", body: "{" }))).rejects.toMatchObject({ code: "invalid_tts_request" });
    await expect(readTtsRequest(new Request("https://example.test", { method: "POST" }))).rejects.toMatchObject({ code: "invalid_tts_request" });
  });
});
