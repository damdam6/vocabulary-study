import type { Profile } from "../profiles.ts";
import { validateMp3 } from "./audio.ts";
import { decidePronunciation, createSynthesisInput } from "./pronunciation.ts";
import {
  buildAudioObjectKey,
  createTtsAudioMetadata,
  createTtsAudioStorage,
  type TtsAudioStorageBucket,
} from "./storage.ts";
import {
  TTS_ERROR_RESPONSES,
  TTS_STORAGE_TIMEOUT_MS,
  TTS_SYNTHESIS_TIMEOUT_MS,
  type NormalizedTtsInput,
  type PronunciationDecision,
  type TtsConfig,
  type TtsErrorCode,
  type TtsProvider,
  type TtsResponseDiagnostics,
  type ValidateAudio,
} from "./types.ts";

type TtsAudioStorage = ReturnType<typeof createTtsAudioStorage>;

export interface TtsServiceClock {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TtsStorageObservation {
  readonly outcome: "saved" | "conflict" | "failed";
  readonly elapsedMs: number;
  readonly requestId: string;
  readonly revision: string;
}

export interface CreateTtsAudioServiceOptions {
  readonly storage: TtsAudioStorage;
  readonly provider: TtsProvider;
  readonly clock?: TtsServiceClock;
  readonly registerBackgroundTask?: (promise: Promise<unknown>) => void;
  readonly observeStorage?: (observation: TtsStorageObservation) => void;
  readonly createRequestId?: () => string;
  /** 동기 MP3 검사는 합성 12초 예산 안에서만 수행한다. */
  readonly validateAudio?: ValidateAudio;
}

export interface TtsAudioServiceRequest {
  readonly profile: Pick<Profile, "id" | "sheetId">;
  readonly input: NormalizedTtsInput;
  readonly config: TtsConfig;
  readonly signal: AbortSignal;
}

export type TtsAudioServiceResponse = TtsResponseDiagnostics & {
  readonly audio: Uint8Array;
  readonly contentType: "audio/mpeg";
  readonly pronunciationDecision: PronunciationDecision;
  readonly billedCharacters?: number;
};

/** HTTP 계층이 공개 오류를 안전하게 직렬화할 수 있는 서비스 오류. */
export class TtsServiceError extends Error {
  readonly code: Extract<TtsErrorCode, "tts_storage_unavailable" | "tts_unavailable" | "tts_upstream_error" | "tts_timeout">;
  readonly status: number;

  constructor(code: TtsServiceError["code"]) {
    super(TTS_ERROR_RESPONSES[code].message);
    this.name = "TtsServiceError";
    this.code = code;
    this.status = TTS_ERROR_RESPONSES[code].status;
  }
}

class DeadlineExceeded extends Error {
  constructor() {
    super("TTS step deadline exceeded");
  }
}

const defaultClock: TtsServiceClock = {
  now: () => typeof performance === "undefined" ? Date.now() : performance.now(),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * 검증된 입력의 R2 조회·합성·조건부 저장을 조합한다. HTTP/인증/ctx 수명은 호출자가
 * 소유하며, 이 함수는 원래 put Promise의 관측용 파생 Promise만 등록한다.
 */
export function createTtsAudioService(options: CreateTtsAudioServiceOptions) {
  const clock = options.clock ?? defaultClock;
  const registerBackgroundTask = options.registerBackgroundTask ?? (() => undefined);
  const observeStorage = options.observeStorage ?? defaultStorageObserver;
  const createRequestId = options.createRequestId ?? defaultRequestId;
  const validateAudio = options.validateAudio ?? validateMp3;

  return async function getOrCreateTtsAudio(request: TtsAudioServiceRequest): Promise<TtsAudioServiceResponse> {
    throwIfAborted(request.signal);
    const key = await buildAudioObjectKey(request.profile, request.input, request.config);
    throwIfAborted(request.signal);
    const pronunciationDecision = decidePronunciation(request.input);

    const readDeadline = clock.now() + TTS_STORAGE_TIMEOUT_MS;
    let stored;
    try {
      stored = await readBeforeDeadline(options.storage, key, readDeadline, request.signal, clock);
    } catch {
      rethrowAbort(request.signal);
      throw new TtsServiceError("tts_storage_unavailable");
    }
    if (stored !== null) return storedResponse(stored.bytes, request.config, pronunciationDecision);
    throwIfAborted(request.signal);

    const synthesisController = new AbortController();
    const propagateAbort = () => synthesisController.abort(request.signal.reason);
    request.signal.addEventListener("abort", propagateAbort, { once: true });
    const synthesisDeadline = clock.now() + TTS_SYNTHESIS_TIMEOUT_MS;
    const timeoutReason = new DeadlineExceeded();
    let synthesized: Awaited<ReturnType<TtsProvider["synthesize"]>>;
    try {
      const synthesis = options.provider.synthesize(createSynthesisInput(request.input), synthesisController.signal);
      synthesized = await awaitBeforeDeadline(synthesis, synthesisDeadline, request.signal, clock, () => {
        synthesisController.abort(timeoutReason);
      });
      throwIfAborted(request.signal);
      if (clock.now() >= synthesisDeadline) {
        synthesisController.abort(timeoutReason);
        throw timeoutReason;
      }
      if (synthesized.contentType !== "audio/mpeg" || !validateAudio(synthesized.audio, synthesized.contentType)) {
        throw new TtsServiceError("tts_upstream_error");
      }
      throwIfAborted(request.signal);
      if (clock.now() >= synthesisDeadline) {
        synthesisController.abort(timeoutReason);
        throw timeoutReason;
      }
    } catch (error) {
      rethrowAbort(request.signal);
      if (error === timeoutReason || error instanceof DeadlineExceeded) throw new TtsServiceError("tts_timeout");
      if (error instanceof TtsServiceError) throw error;
      throw providerError(error);
    } finally {
      request.signal.removeEventListener("abort", propagateAbort);
    }
    throwIfAborted(request.signal);

    const writeDeadline = clock.now() + TTS_STORAGE_TIMEOUT_MS;
    const writeStartedAt = clock.now();
    const requestId = createRequestId();
    let putPromise: Promise<"saved" | "conflict">;
    try {
      putPromise = options.storage.putIfAbsent(key, synthesized.audio, createTtsAudioMetadata(request.input, request.config));
    } catch {
      return generatedResponse(synthesized, request.config, pronunciationDecision, "UNCONFIRMED");
    }
    const observation = putPromise.then(
      (outcome) => {
        safelyObserve(observeStorage, { outcome, elapsedMs: elapsed(clock, writeStartedAt), requestId, revision: request.config.revision });
      },
      () => {
        safelyObserve(observeStorage, { outcome: "failed", elapsedMs: elapsed(clock, writeStartedAt), requestId, revision: request.config.revision });
      },
    );
    try {
      registerBackgroundTask(observation);
    } catch {
      // 등록 실패가 검증된 생성 MP3의 foreground 결과를 바꾸지 않는다.
      console.warn("tts_storage_registration_failed", { requestId, revision: request.config.revision });
    }

    try {
      const putResult = await awaitBeforeDeadline(putPromise, writeDeadline, request.signal, clock);
      throwIfAborted(request.signal);
      if (putResult === "saved") return generatedResponse(synthesized, request.config, pronunciationDecision, "SAVED");

      // conflict 재조회는 writeDeadline의 남은 시간만 사용한다.
      if (clock.now() >= writeDeadline) return generatedResponse(synthesized, request.config, pronunciationDecision, "UNCONFIRMED");
      const winner = await readBeforeDeadline(options.storage, key, writeDeadline, request.signal, clock);
      throwIfAborted(request.signal);
      if (winner !== null) return storedResponse(winner.bytes, request.config, pronunciationDecision, synthesized.billedCharacters);
    } catch {
      rethrowAbort(request.signal);
      // 저장의 예외·초과·경합 재조회 실패는 이미 검증한 생성 MP3로 축소한다.
    }
    return generatedResponse(synthesized, request.config, pronunciationDecision, "UNCONFIRMED");
  };
}

/** 실제 R2 binding과 공용 MP3 검사기를 서비스 경계에서만 연결한다. */
export function createR2TtsAudioService(
  bucket: TtsAudioStorageBucket,
  options: Omit<CreateTtsAudioServiceOptions, "storage">,
) {
  return createTtsAudioService({ ...options, storage: createTtsAudioStorage(bucket, validateMp3), validateAudio: validateMp3 });
}

function storedResponse(
  audio: Uint8Array,
  config: TtsConfig,
  pronunciationDecision: PronunciationDecision,
  billedCharacters?: number,
): TtsAudioServiceResponse {
  return {
    audio,
    contentType: "audio/mpeg",
    source: "STORED",
    storage: "PRESENT",
    pronunciation: pronunciationDecision.status,
    pronunciationDecision,
    revision: config.revision,
    ...(billedCharacters === undefined ? {} : { billedCharacters }),
  };
}

function generatedResponse(
  synthesis: Awaited<ReturnType<TtsProvider["synthesize"]>>,
  config: TtsConfig,
  pronunciationDecision: PronunciationDecision,
  storage: "SAVED" | "UNCONFIRMED",
): TtsAudioServiceResponse {
  return {
    audio: synthesis.audio,
    contentType: "audio/mpeg",
    source: "GENERATED",
    storage,
    pronunciation: pronunciationDecision.status,
    pronunciationDecision,
    revision: config.revision,
    ...(synthesis.billedCharacters === undefined ? {} : { billedCharacters: synthesis.billedCharacters }),
  };
}

async function readBeforeDeadline(
  storage: TtsAudioStorage,
  key: string,
  deadline: number,
  signal: AbortSignal,
  clock: TtsServiceClock,
): Promise<Awaited<ReturnType<TtsAudioStorage["get"]>>> {
  throwIfAborted(signal);
  if (clock.now() >= deadline) throw new DeadlineExceeded();
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await awaitBeforeDeadline(storage.get(key, controller.signal), deadline, signal, clock, () => {
      controller.abort(new DeadlineExceeded());
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function awaitBeforeDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  signal: AbortSignal,
  clock: TtsServiceClock,
  onDeadline?: () => void,
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  const remaining = deadline - clock.now();
  if (remaining <= 0) {
    void promise.catch(() => undefined);
    onDeadline?.();
    return Promise.reject(new DeadlineExceeded());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    let timer: unknown;
    timer = clock.setTimeout(() => finish(() => {
      onDeadline?.();
      reject(new DeadlineExceeded());
    }), remaining);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => {
        if (clock.now() >= deadline) {
          onDeadline?.();
          reject(new DeadlineExceeded());
          return;
        }
        resolve(value);
      }),
      (error) => finish(() => reject(error)),
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

function rethrowAbort(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

function providerError(error: unknown): TtsServiceError {
  if (isProviderError(error, "tts_unavailable")) return new TtsServiceError("tts_unavailable");
  return new TtsServiceError("tts_upstream_error");
}

function isProviderError(error: unknown, code: "tts_unavailable"): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function safelyObserve(observer: (observation: TtsStorageObservation) => void, observation: TtsStorageObservation): void {
  try { observer(observation); } catch { /* observations are never part of the foreground contract */ }
}

function elapsed(clock: TtsServiceClock, startedAt: number): number {
  return Math.max(0, clock.now() - startedAt);
}

function defaultRequestId(): string {
  return crypto.randomUUID();
}

function defaultStorageObserver(observation: TtsStorageObservation): void {
  console.info("tts_storage_write", observation);
}
