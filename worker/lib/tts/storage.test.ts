import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../profiles.ts";
import { normalizeTtsInput } from "./input.ts";
import {
  buildAudioObjectKey,
  createTtsAudioMetadata,
  createTtsAudioStorage,
  TtsStoredAudioError,
  type TtsAudioStorageBucket,
  type TtsAudioStorageObject,
} from "./storage.ts";
import { MAX_TTS_AUDIO_BYTES, TTS_ADAPTER_VERSION, TTS_AUDIO_SETTINGS, TTS_MODEL, TTS_OUTPUT_FORMAT, TTS_PRONUNCIATION_POLICY, TTS_PROVIDER, TTS_REGION, TTS_VOICE, type TtsConfig } from "./types.ts";

const profile: Pick<Profile, "id" | "sheetId"> = { id: "learner", sheetId: "sheet-private-id" };
const config: TtsConfig = {
  provider: TTS_PROVIDER,
  model: TTS_MODEL,
  voice: TTS_VOICE,
  rate: 1,
  revision: "tts-v1",
  region: TTS_REGION,
  outputFormat: TTS_OUTPUT_FORMAT,
  adapterVersion: TTS_ADAPTER_VERSION,
  pronunciationPolicy: TTS_PRONUNCIATION_POLICY,
  endpoint: "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference",
  upgradeEndpoint: "https://dashscope-intl.aliyuncs.com/api-ws/v1/inference",
  audioSettings: TTS_AUDIO_SETTINGS,
};
const input = normalizeTtsInput({ text: "行", pinyin: "háng" });

function object(bytes: Uint8Array, overrides: Partial<TtsAudioStorageObject> = {}): TtsAudioStorageObject {
  return {
    size: bytes.byteLength,
    httpMetadata: { contentType: "audio/mpeg" },
    body: streamOf(bytes),
    ...overrides,
  };
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function metadata() {
  return createTtsAudioMetadata(input, config);
}

describe("R2 오디오 키", () => {
  it("고정 튜플을 SHA-256으로 경로화하고 운영 무관 필드를 제외한다", async () => {
    const key = await buildAudioObjectKey(profile, input, config);
    expect(key).toBe("audio/v1/d5d19c62e52983e370d66afbe085aef2dff6cbeda3d62103e49f65d2d34bf499/tts-v1/cb695b6ce3fea6b73831b3b6e97db0c12978c733505d09509f94b497e40492d4.mp3");
    expect(key).not.toContain(profile.id);
    expect(key).not.toContain(profile.sheetId);
    expect(await buildAudioObjectKey({ ...profile }, { ...input }, { ...config })).toBe(key);
    expect(await buildAudioObjectKey(profile, input, { ...config, endpoint: "wss://ignored.test" } as unknown as TtsConfig)).toBe(key);
  });

  it("프로필/시트/B열 및 명시적 설정·텍스트 변경을 구분한다", async () => {
    const key = await buildAudioObjectKey(profile, input, config);
    await expect(buildAudioObjectKey({ ...profile, id: "other" }, input, config)).resolves.not.toBe(key);
    await expect(buildAudioObjectKey({ ...profile, sheetId: "other-sheet" }, input, config)).resolves.not.toBe(key);
    await expect(buildAudioObjectKey(profile, { ...input, pinyin: null }, config)).resolves.not.toBe(key);
    await expect(buildAudioObjectKey(profile, { ...input, text: "重" }, config)).resolves.not.toBe(key);
    await expect(buildAudioObjectKey(profile, input, { ...config, revision: "tts-v2" })).resolves.not.toBe(key);
    await expect(buildAudioObjectKey(profile, input, { ...config, rate: 1.5 })).resolves.not.toBe(key);

    const sentence = { text: "今天下午三点，我们  一起去图书馆学习。价格是3.5元。", pinyin: "jīntiān xiàwǔ" };
    const sentenceKey = await buildAudioObjectKey(profile, sentence, config);
    await expect(buildAudioObjectKey(profile, { ...sentence, pinyin: "jīn tiān xià wǔ" }, config)).resolves.not.toBe(sentenceKey);
    await expect(buildAudioObjectKey(profile, { ...sentence, text: sentence.text.replace("3.5", "35") }, config)).resolves.not.toBe(sentenceKey);
    await expect(buildAudioObjectKey(profile, sentence, { ...config, revision: "tts-v2" })).resolves.not.toBe(sentenceKey);
  });

  it("정규화 전후 동치 입력과 metadata allowlist를 고정한다", async () => {
    const normalized = normalizeTtsInput({ text: " \r\n行 ", pinyin: " ha\u0301ng\r\n" });
    expect(await buildAudioObjectKey(profile, normalized, config)).toBe(await buildAudioObjectKey(profile, input, config));
    expect(metadata()).toEqual({
      config: expect.objectContaining({ provider: "qwen", model: TTS_MODEL, voice: TTS_VOICE, rate: 1, revision: "tts-v1", adapterVersion: TTS_ADAPTER_VERSION, outputFormat: "mp3" }),
      characterCount: 1,
    });
  });
});

describe("R2 조회", () => {
  it.each(["pending", "reject"])("preserves overflow errors and releases the lock when cancel is %s", async (mode) => {
    const cancel = vi.fn(() => mode === "pending" ? new Promise<void>(() => {}) : Promise.reject(new Error("cancel failed")));
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_TTS_AUDIO_BYTES + 1)); }, cancel,
    });
    const bucket = { get: vi.fn().mockResolvedValue(object(new Uint8Array([1]), { body })), put: vi.fn() };
    await expect(createTtsAudioStorage(bucket, () => true).get("key")).rejects.toBeInstanceOf(TtsStoredAudioError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it.each(["pending", "reject"])("abort releases the pending reader even when cancel is %s", async (mode) => {
    const cancel = vi.fn(() => mode === "pending" ? new Promise<void>(() => {}) : Promise.reject(new Error("cancel failed")));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const bucket = { get: vi.fn().mockResolvedValue(object(new Uint8Array([1]), { body })), put: vi.fn() };
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const result = createTtsAudioStorage(bucket, () => true).get("key", controller.signal);
    const assertion = expect(result).rejects.toBe(reason);
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort(reason);
    await assertion;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
    expect(body.locked).toBe(false);
  });

  it.each(["mime", "size"])("cancels rejected %s metadata without waiting for cancellation", async (field) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const invalid = object(new Uint8Array([1]), { body, ...(field === "mime" ? { httpMetadata: {} } : { size: MAX_TTS_AUDIO_BYTES + 1 }) });
    const bucket = { get: vi.fn().mockResolvedValue(invalid), put: vi.fn() };
    await expect(createTtsAudioStorage(bucket, () => true).get("key")).rejects.toBeInstanceOf(TtsStoredAudioError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it("does not start an already aborted get", async () => {
    const bucket = { get: vi.fn(), put: vi.fn() };
    const controller = new AbortController();
    const reason = new Error("already aborted");
    controller.abort(reason);
    await expect(createTtsAudioStorage(bucket, () => true).get("key", controller.signal)).rejects.toBe(reason);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("null만 miss로 반환하고 정상 MP3는 완전한 바이트로 반환한다", async () => {
    const bucket: TtsAudioStorageBucket = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    const storage = createTtsAudioStorage(bucket, () => true);
    await expect(storage.get("missing")).resolves.toBeNull();

    (bucket.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(object(new Uint8Array([1, 2, 3])));
    await expect(storage.get("present")).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" });
  });

  it("조회 실패·손상 메타데이터·크기 불일치·검사기 실패를 miss로 축약하지 않는다", async () => {
    const failure = new Error("R2 unavailable");
    const bucket: TtsAudioStorageBucket = { get: vi.fn(), put: vi.fn() };
    const storage = createTtsAudioStorage(bucket, () => true);
    (bucket.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
    await expect(storage.get("key")).rejects.toBe(failure);

    const readFailure = new Error("body read failed");
    const failedBody = new ReadableStream<Uint8Array>({ start(controller) { controller.error(readFailure); } });
    (bucket.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ size: 1, httpMetadata: { contentType: "audio/mpeg" }, body: failedBody });
    await expect(storage.get("key")).rejects.toBe(readFailure);
    expect(failedBody.locked).toBe(false);

    for (const invalid of [
      object(new Uint8Array([1]), { httpMetadata: {} }),
      object(new Uint8Array([1]), { httpMetadata: { contentType: "application/octet-stream" } }),
      object(new Uint8Array(), { size: 0 }),
      object(new Uint8Array([1]), { size: 2 }),
      object(new Uint8Array([1]), { size: MAX_TTS_AUDIO_BYTES + 1 }),
    ]) {
      (bucket.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(invalid);
      await expect(storage.get("key")).rejects.toBeInstanceOf(TtsStoredAudioError);
    }

    (bucket.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(object(new Uint8Array([1])));
    await expect(createTtsAudioStorage(bucket, () => false).get("key")).rejects.toBeInstanceOf(TtsStoredAudioError);
    const validatorFailure = new Error("validator failure");
    (bucket.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(object(new Uint8Array([1])));
    await expect(createTtsAudioStorage(bucket, () => { throw validatorFailure; }).get("key")).rejects.toBe(validatorFailure);
  });

  it("상한 초과 스트림은 취소하고 reader lock을 해제한다", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_TTS_AUDIO_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const bucket: TtsAudioStorageBucket = { get: vi.fn().mockResolvedValue({ size: 1, httpMetadata: { contentType: "audio/mpeg" }, body }), put: vi.fn() };
    await expect(createTtsAudioStorage(bucket, () => true).get("key")).rejects.toBeInstanceOf(TtsStoredAudioError);
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});

describe("조건부 R2 저장", () => {
  it("검증한 view만 If-None-Match 조건과 allowlist metadata로 한 번 저장한다", async () => {
    const bucket: TtsAudioStorageBucket = { get: vi.fn(), put: vi.fn().mockResolvedValue({ key: "key" }) };
    const storage = createTtsAudioStorage(bucket, (audio, contentType) => contentType === "audio/mpeg" && audio[0] === 2);
    const backing = new Uint8Array([1, 2, 3, 4]);
    await expect(storage.putIfAbsent("key", backing.subarray(1, 3), metadata())).resolves.toBe("saved");
    expect(bucket.put).toHaveBeenCalledTimes(1);
    const [, value, options] = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Uint8Array, { onlyIf: Headers; httpMetadata: { contentType: string }; customMetadata: Record<string, string> }];
    expect(Array.from(value)).toEqual([2, 3]);
    expect(options.onlyIf.get("If-None-Match")).toBe("*");
    expect(options.httpMetadata).toEqual({ contentType: "audio/mpeg" });
    expect(options.customMetadata).toEqual({ provider: "qwen", model: TTS_MODEL, voice: TTS_VOICE, rate: "1", revision: "tts-v1", adapterVersion: TTS_ADAPTER_VERSION, characterCount: "1", formatVersion: "tts-audio-v1" });
  });

  it("경합은 conflict로 구분하며 일반 put·재조회·재시도를 하지 않는다", async () => {
    let saved: Uint8Array | null = null;
    const bucket: TtsAudioStorageBucket = {
      get: vi.fn(),
      put: vi.fn(async (_key, value) => {
        if (saved) return null;
        saved = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return { key: "key" };
      }),
    };
    const storage = createTtsAudioStorage(bucket, () => true);
    await expect(storage.putIfAbsent("key", new Uint8Array([1]), metadata())).resolves.toBe("saved");
    await expect(storage.putIfAbsent("key", new Uint8Array([2]), metadata())).resolves.toBe("conflict");
    expect(saved).toEqual(new Uint8Array([1]));
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.put).toHaveBeenCalledTimes(2);
  });

  it("검증 실패에는 put하지 않고 R2 reject는 원래 Promise로 전파한다", async () => {
    const bucket: TtsAudioStorageBucket = { get: vi.fn(), put: vi.fn() };
    const storage = createTtsAudioStorage(bucket, () => false);
    await expect(storage.putIfAbsent("key", new Uint8Array([1]), metadata())).rejects.toBeInstanceOf(TtsStoredAudioError);
    expect(bucket.put).not.toHaveBeenCalled();

    const failure = new Error("put failed");
    (bucket.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
    await expect(createTtsAudioStorage(bucket, () => true).putIfAbsent("key", new Uint8Array([1]), metadata())).rejects.toBe(failure);
  });

  it("호출부가 보관한 늦은 저장 Promise의 성공과 실패를 계속 관측할 수 있다", async () => {
    let resolvePut!: (value: unknown) => void;
    const delayed = new Promise<unknown>((resolve) => { resolvePut = resolve; });
    const bucket: TtsAudioStorageBucket = { get: vi.fn(), put: vi.fn().mockReturnValue(delayed) };
    const putPromise = createTtsAudioStorage(bucket, () => true).putIfAbsent("key", new Uint8Array([1]), metadata());
    await expect(Promise.race([putPromise.then(() => "complete"), Promise.resolve("deadline")])).resolves.toBe("deadline");
    resolvePut({ key: "key" });
    await expect(putPromise).resolves.toBe("saved");

    let rejectPut!: (reason: unknown) => void;
    const rejected = new Promise<unknown>((_resolve, reject) => { rejectPut = reject; });
    (bucket.put as ReturnType<typeof vi.fn>).mockReturnValueOnce(rejected);
    const rejectedPromise = createTtsAudioStorage(bucket, () => true).putIfAbsent("key", new Uint8Array([1]), metadata());
    await expect(Promise.race([rejectedPromise.then(() => "complete", () => "failed"), Promise.resolve("deadline")])).resolves.toBe("deadline");
    const lateFailure = new Error("late put failure");
    rejectPut(lateFailure);
    await expect(rejectedPromise).rejects.toBe(lateFailure);
  });
});
