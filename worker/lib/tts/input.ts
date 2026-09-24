import { MAX_TTS_PINYIN_LENGTH, MAX_TTS_REQUEST_BYTES, MAX_TTS_TEXT_LENGTH, type NormalizedTtsInput } from "./types.ts";

export class TtsInputError extends Error {
  readonly code: "invalid_tts_request" | "tts_request_too_large";

  constructor(code: "invalid_tts_request" | "tts_request_too_large") {
    super(code);
    this.name = "TtsInputError";
    this.code = code;
  }
}

/** 실제 스트림 바이트 상한을 지키며 JSON 요청을 읽는다. Content-Length는 조기 거부 보조일 뿐이다. */
export async function readTtsRequest(request: Request): Promise<NormalizedTtsInput> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_TTS_REQUEST_BYTES) {
    throw new TtsInputError("tts_request_too_large");
  }
  const bytes = await readLimitedBody(request.body);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TtsInputError("invalid_tts_request");
  }
  return normalizeTtsInput(value);
}

/** 객체 allowlist와 문자열 정규화를 분리해 라우트 밖에서도 테스트·재사용한다. */
export function normalizeTtsInput(value: unknown): NormalizedTtsInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "text" && key !== "pinyin") || typeof value.text !== "string") {
    throw new TtsInputError("invalid_tts_request");
  }
  if (value.pinyin !== undefined && typeof value.pinyin !== "string") {
    throw new TtsInputError("invalid_tts_request");
  }

  const text = normalizeText(value.text);
  if (Array.from(text).length < 1 || Array.from(text).length > MAX_TTS_TEXT_LENGTH || !/\p{Script=Han}/u.test(text)) {
    throw new TtsInputError("invalid_tts_request");
  }
  const pinyin = value.pinyin === undefined ? null : normalizePinyin(value.pinyin);
  if (pinyin !== null && Array.from(pinyin).length > MAX_TTS_PINYIN_LENGTH) {
    throw new TtsInputError("invalid_tts_request");
  }
  return { text, pinyin };
}

/** @deprecated 정확한 계약명 normalizeTtsInput을 사용한다. */
export const normalizeTtsRequest = normalizeTtsInput;

function normalizeText(value: string): string {
  // trim 전에 검사해야 VT/FF처럼 trim으로 사라지는 금지 C0가 묵인되지 않는다.
  if (hasForbiddenTextControl(value)) {
    throw new TtsInputError("invalid_tts_request");
  }
  return value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

function hasForbiddenTextControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 8 || codePoint === 11 || codePoint === 12 || (codePoint >= 14 && codePoint <= 31)) {
      return true;
    }
  }
  return false;
}

function normalizePinyin(value: string): string | null {
  const normalized = value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  return normalized === "" ? null : normalized;
}

async function readLimitedBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_TTS_REQUEST_BYTES) {
        await reader.cancel();
        throw new TtsInputError("tts_request_too_large");
      }
      chunks.push(value);
      length += value.byteLength;
    }
  } catch (error) {
    if (error instanceof TtsInputError) throw error;
    throw new TtsInputError("invalid_tts_request");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
