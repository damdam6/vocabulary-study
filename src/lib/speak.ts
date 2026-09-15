import {
  TTS_MAX_TEXT_LENGTH,
  type PronunciationController,
  type PronunciationInput,
  type PronunciationInputReason,
  type PronunciationSnapshot,
  type TtsAudioOutput,
  type TtsBlobCache,
  type TtsCapability,
  type TtsPlayResult,
  type TtsTransport,
  type TtsTransportFailure,
} from "./ttsTypes.ts";

export interface CreatePronunciationControllerOptions {
  profileId: string;
  capability: TtsCapability;
  transport: TtsTransport;
  audio: TtsAudioOutput;
  cache: TtsBlobCache;
}

interface NormalizedInput {
  text: string;
  pinyin: string | null;
}

interface RequestRecord {
  generation: number;
  questionId: string;
  controller: AbortController;
}

interface PlayAttempt {
  token: number;
  generation: number;
  questionId: string;
  intent: "auto" | "manual";
  terminal: boolean;
  unsubscribe: () => void;
}

const MANUAL_FAILURE_MESSAGE = "발음을 불러오지 못했어요. 다시 눌러 주세요.";
const MANUAL_BLOCKED_MESSAGE = "발음이 준비됐어요. 다시 눌러 주세요.";

/**
 * 세션 하나에 속하는 React 비의존 발음 controller.
 *
 * cache key는 `JSON.stringify([profileId, effectiveRevision, text, pinyin])`이며
 * questionId나 word 객체 identity는 포함하지 않는다. 현재 응답의 revision만
 * effective revision을 교체하고 cache를 비우므로, 오래된 응답은 다른 질문의
 * Blob·revision·snapshot을 변경할 수 없다.
 */
export function createPronunciationController(options: CreatePronunciationControllerOptions): PronunciationController {
  const { profileId, capability, transport, audio, cache } = options;
  let enabled = capability.enabled;
  let effectiveRevision = capability.enabled ? capability.revision : "";
  let disposed = false;
  let generation = 0;
  let playSequence = 0;
  let questionId: string | null = null;
  let input: NormalizedInput | null = null;
  let inputReason: PronunciationInputReason | null = null;
  let viewReady = false;
  let autoConsumed = false;
  let prepareAttempted = false;
  let hiddenStopped = false;
  let pendingIntent: "auto" | "manual" | null = null;
  let request: RequestRecord | null = null;
  let blob: Blob | null = null;
  let pinnedKey: string | null = null;
  let playAttempt: PlayAttempt | null = null;
  const listeners = new Set<(snapshot: PronunciationSnapshot) => void>();
  let snapshot: PronunciationSnapshot = freezeSnapshot({
    status: "idle", questionId: null, enabled, inputReason: null, message: null,
  });

  const isCurrent = (expectedGeneration: number, expectedQuestionId: string): boolean =>
    !disposed && generation === expectedGeneration && questionId === expectedQuestionId;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try { listener(snapshot); } catch {}
    }
  };

  const update = (next: Partial<PronunciationSnapshot>): void => {
    const candidate: PronunciationSnapshot = {
      status: next.status ?? snapshot.status,
      questionId: next.questionId === undefined ? snapshot.questionId : next.questionId,
      enabled: next.enabled ?? snapshot.enabled,
      inputReason: next.inputReason === undefined ? snapshot.inputReason : next.inputReason,
      message: next.message === undefined ? snapshot.message : next.message,
    };
    if (
      candidate.status === snapshot.status && candidate.questionId === snapshot.questionId &&
      candidate.enabled === snapshot.enabled && candidate.inputReason === snapshot.inputReason &&
      candidate.message === snapshot.message
    ) return;
    snapshot = freezeSnapshot(candidate);
    notify();
  };

  const unpin = (): void => {
    if (pinnedKey !== null) cache.unpin(pinnedKey);
    pinnedKey = null;
  };

  const cancelPlay = (): void => {
    if (playAttempt) {
      playAttempt.terminal = true;
      playAttempt.unsubscribe();
      playAttempt = null;
    }
    try { audio.stop(); } catch {}
  };

  const invalidate = (): void => {
    generation += 1;
    if (request) {
      try { request.controller.abort(); } catch {}
      request = null;
    }
    cancelPlay();
    unpin();
    blob = null;
    pendingIntent = null;
  };

  const currentKey = (): string | null => input === null ? null : JSON.stringify([profileId, effectiveRevision, input.text, input.pinyin]);

  const useBlob = (value: Blob, key: string): void => {
    unpin();
    blob = value;
    const stored = cache.set(key, value).stored;
    if (stored) {
      cache.pin(key);
      pinnedKey = key;
    }
  };

  const loadCachedBlob = (): boolean => {
    const key = currentKey();
    if (key === null) return false;
    const cached = cache.get(key);
    if (!cached) return false;
    unpin();
    blob = cached;
    cache.pin(key);
    pinnedKey = key;
    return true;
  };

  const clearRequest = (record: RequestRecord): void => {
    if (request === record) request = null;
  };

  const disable = (): void => {
    enabled = false;
    if (request) {
      try { request.controller.abort(); } catch {}
      request = null;
    }
    cancelPlay();
    unpin();
    blob = null;
    pendingIntent = null;
    cache.clear();
    update({ status: "idle", enabled: false, inputReason: null, message: null });
  };

  const startPlay = (intent: "auto" | "manual"): void => {
    if (!input || !blob || questionId === null || disposed || !enabled || !viewReady) return;
    const expectedGeneration = generation;
    const expectedQuestionId = questionId;
    if (playAttempt) {
      playAttempt.terminal = true;
      playAttempt.unsubscribe();
      playAttempt = null;
    }
    const attempt: PlayAttempt = {
      token: ++playSequence,
      generation: expectedGeneration,
      questionId: expectedQuestionId,
      intent,
      terminal: false,
      unsubscribe: () => {},
    };
    const isAttemptCurrent = (): boolean =>
      playAttempt === attempt && !attempt.terminal && isCurrent(expectedGeneration, expectedQuestionId);
    attempt.unsubscribe = audio.subscribe((event) => {
      if (!isAttemptCurrent()) return;
      attempt.terminal = true;
      attempt.unsubscribe();
      if (playAttempt === attempt) playAttempt = null;
      if (event === "ended") update({ status: "ready", message: null });
      else update({ status: "error", message: intent === "manual" ? MANUAL_FAILURE_MESSAGE : null });
    });
    playAttempt = attempt;
    pendingIntent = null;
    let result: Promise<TtsPlayResult>;
    try {
      // Audio port owns the native call; this invocation remains in the click stack.
      result = audio.play(blob);
    } catch (error) {
      result = Promise.resolve({ status: "error", error });
    }
    update({ status: "loading", message: null });
    void Promise.resolve(result).then(
      (outcome) => {
        if (!isAttemptCurrent()) return;
        if (outcome.status === "started") {
          update({ status: "playing", message: null });
        } else if (outcome.status === "blocked") {
          attempt.terminal = true;
          attempt.unsubscribe();
          if (playAttempt === attempt) playAttempt = null;
          update({ status: "blocked", message: intent === "manual" ? MANUAL_BLOCKED_MESSAGE : null });
        } else if (outcome.status === "error") {
          attempt.terminal = true;
          attempt.unsubscribe();
          if (playAttempt === attempt) playAttempt = null;
          update({ status: "error", message: intent === "manual" ? MANUAL_FAILURE_MESSAGE : null });
        } else {
          attempt.terminal = true;
          attempt.unsubscribe();
          if (playAttempt === attempt) playAttempt = null;
          update({ status: blob ? "ready" : "idle", message: null });
        }
      },
      () => {
        if (!isAttemptCurrent()) return;
        attempt.terminal = true;
        attempt.unsubscribe();
        if (playAttempt === attempt) playAttempt = null;
        update({ status: "error", message: intent === "manual" ? MANUAL_FAILURE_MESSAGE : null });
      },
    );
  };

  const startRequest = (): void => {
    if (!input || questionId === null || request || disposed || !enabled) return;
    const expectedGeneration = generation;
    const expectedQuestionId = questionId;
    const record: RequestRecord = { generation: expectedGeneration, questionId: expectedQuestionId, controller: new AbortController() };
    request = record;
    update({ status: "loading", message: null });
    let promise: Promise<Awaited<ReturnType<TtsTransport>>>;
    try {
      const requestInput = input.pinyin === null ? { text: input.text } : { text: input.text, pinyin: input.pinyin };
      promise = transport(requestInput, record.controller.signal);
    } catch (error) {
      promise = Promise.reject(error);
    }
    void Promise.resolve(promise).then(
      (response) => {
        if (!isCurrent(expectedGeneration, expectedQuestionId) || request !== record) return;
        clearRequest(record);
        if (response.revision !== effectiveRevision) {
          unpin();
          cache.clear();
          effectiveRevision = response.revision;
        }
        const key = currentKey();
        if (key === null || !isCurrent(expectedGeneration, expectedQuestionId)) return;
        useBlob(response.audio, key);
        if (!isCurrent(expectedGeneration, expectedQuestionId)) return;
        update({ status: "ready", message: null });
        if (!isCurrent(expectedGeneration, expectedQuestionId)) return;
        const intent = pendingIntent;
        if (viewReady && intent) startPlay(intent);
      },
      (error: unknown) => {
        if (!isCurrent(expectedGeneration, expectedQuestionId) || request !== record) return;
        clearRequest(record);
        const failure = error as Partial<TtsTransportFailure>;
        if (failure.kind === "http" && (failure.error === "tts_disabled" || failure.error === "tts_not_configured")) {
          disable();
          return;
        }
        const intent = pendingIntent;
        pendingIntent = null;
        autoConsumed = true;
        update({ status: "error", message: intent === "manual" ? MANUAL_FAILURE_MESSAGE : null });
      },
    );
  };

  return {
    activate(nextQuestionId, rawInput) {
      if (disposed || nextQuestionId === questionId) return;
      invalidate();
      questionId = nextQuestionId;
      input = normalizeInput(rawInput);
      inputReason = input === null ? inputReasonFor(rawInput) : null;
      viewReady = false;
      autoConsumed = false;
      prepareAttempted = false;
      hiddenStopped = false;
      update({ status: "idle", questionId, enabled, inputReason, message: null });
    },

    prepare(expectedQuestionId) {
      if (disposed || expectedQuestionId !== questionId || !enabled || !input || hiddenStopped || prepareAttempted) return;
      prepareAttempted = true;
      if (loadCachedBlob()) {
        update({ status: "ready", message: null });
        return;
      }
      startRequest();
    },

    reveal(expectedQuestionId) {
      if (disposed || expectedQuestionId !== questionId || !enabled || !input || hiddenStopped) return;
      viewReady = true;
      if (autoConsumed) return;
      if (pendingIntent === "manual") return;
      autoConsumed = true;
      if (blob || loadCachedBlob()) {
        startPlay("auto");
        return;
      }
      pendingIntent = "auto";
      if (!prepareAttempted) {
        prepareAttempted = true;
        startRequest();
      }
    },

    replay(expectedQuestionId) {
      if (disposed || expectedQuestionId !== questionId || !enabled || !input) return;
      hiddenStopped = false;
      autoConsumed = true;
      pendingIntent = "manual";
      if (blob || loadCachedBlob()) {
        startPlay("manual");
        return;
      }
      if (!request) {
        prepareAttempted = true;
        startRequest();
      }
    },

    stop(reason) {
      if (disposed) return;
      invalidate();
      autoConsumed = true;
      if (reason === "hidden") {
        hiddenStopped = true;
        update({ status: "idle", message: null });
        return;
      }
      questionId = null;
      input = null;
      inputReason = null;
      viewReady = false;
      prepareAttempted = false;
      hiddenStopped = false;
      update({ status: "idle", questionId: null, inputReason: null, message: null });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      try { audio.dispose(); } catch {}
      try { cache.dispose(); } catch {}
      listeners.clear();
    },

    getSnapshot() { return snapshot; },

    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
  };
}

function freezeSnapshot(snapshot: PronunciationSnapshot): PronunciationSnapshot {
  return Object.freeze({ ...snapshot });
}

function normalizeInput(value: PronunciationInput): NormalizedInput | null {
  try {
    if (typeof value.text !== "string" || (value.pinyin !== null && typeof value.pinyin !== "string")) return null;
    if (hasForbiddenTextControl(value.text)) return null;
    const text = value.text.replace(/\r\n?/g, "\n").normalize("NFC").trim();
    const pinyin = value.pinyin === null ? null : value.pinyin.replace(/\r\n?/g, "\n").normalize("NFC").trim() || null;
    if (Array.from(text).length === 0 || !/\p{Script=Han}/u.test(text)) return null;
    if (Array.from(text).length > TTS_MAX_TEXT_LENGTH || (pinyin !== null && Array.from(pinyin).length > 1_000)) return null;
    return { text, pinyin };
  } catch {
    return null;
  }
}

function inputReasonFor(value: PronunciationInput): PronunciationInputReason {
  if (typeof value.text === "string") {
    try {
      const normalized = value.text.replace(/\r\n?/g, "\n").normalize("NFC").trim();
      if (Array.from(normalized).length > TTS_MAX_TEXT_LENGTH) return "text_too_long";
    } catch {}
  }
  return "invalid_text";
}

function hasForbiddenTextControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 8 || codePoint === 11 || codePoint === 12 || (codePoint >= 14 && codePoint <= 31)) return true;
  }
  return false;
}
