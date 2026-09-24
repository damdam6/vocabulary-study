/**
 * 브라우저가 Worker를 import하지 않고 소비하는 TTS 공개 계약과 후속 구현 포트.
 * 값·알고리즘은 이 파일에 두지 않는다.
 */

export const TTS_MAX_TEXT_LENGTH = 200;
export const TTS_BLOB_CACHE_MAX_ENTRIES = 20;
export const TTS_BLOB_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const TTS_ERROR_CODES = [
  "invalid_tts_request", "tts_not_allowed", "method_not_allowed", "tts_request_too_large", "unsupported_media_type",
  "tts_disabled", "tts_not_configured", "tts_unavailable", "tts_storage_unavailable", "tts_upstream_error", "tts_timeout",
] as const;
export type TtsErrorCode = (typeof TTS_ERROR_CODES)[number];

export interface TtsRequest {
  text: string;
  pinyin?: string;
}

export type TtsCapability =
  | { enabled: false }
  | { enabled: true; revision: string; maxTextLength: typeof TTS_MAX_TEXT_LENGTH };

export type TtsSource = "STORED" | "GENERATED";
export type TtsStorage = "PRESENT" | "SAVED" | "UNCONFIRMED";
export type TtsPronunciation = "absent" | "ignored";

export type TtsAudioResponse =
  | { audio: Blob; source: "STORED"; storage: "PRESENT"; pronunciation: TtsPronunciation; revision: string; billedCharacters?: number }
  | { audio: Blob; source: "GENERATED"; storage: "SAVED" | "UNCONFIRMED"; pronunciation: TtsPronunciation; revision: string; billedCharacters?: number };

export type TtsTransportFailure =
  | { kind: "aborted" }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "invalid_response" }
  | { kind: "http"; status: number; error: TtsErrorCode; message: string };

export type TtsTransport = (input: TtsRequest, signal: AbortSignal) => Promise<TtsAudioResponse>;

export type TtsPlayResult =
  | { status: "started" }
  | { status: "blocked" }
  | { status: "cancelled" }
  | { status: "error"; error: unknown };
export type TtsAudioOutputEvent = "ended" | "error";

export interface TtsAudioOutput {
  /** 호출한 동기 사용자 제스처 경로에서 native play를 시작해야 한다. */
  play(blob: Blob): Promise<TtsPlayResult>;
  stop(): void;
  dispose(): void;
  subscribe(listener: (event: TtsAudioOutputEvent) => void): () => void;
}

export interface TtsBlobCache {
  /** 동기 조회; prepared/playing 항목은 pin으로 보호한다. Object URL은 저장하지 않는다. */
  get(key: string): Blob | undefined;
  /** 20개/8MiB 한도에서 보관하지 못해도 받은 Blob 재생은 막지 않는다. */
  set(key: string, blob: Blob): { stored: boolean };
  pin(key: string): void;
  unpin(key: string): void;
  clear(): void;
  dispose(): void;
}

export type PronunciationStatus = "idle" | "loading" | "ready" | "playing" | "blocked" | "error";
export type PronunciationInputReason = "text_too_long" | "invalid_text";

export interface PronunciationSnapshot {
  status: PronunciationStatus;
  questionId: string | null;
  enabled: boolean;
  inputReason: PronunciationInputReason | null;
  /** 수동 오류·수동 차단에서만 사용자에게 보여 줄 수 있는 문구. */
  message: string | null;
}

export interface PronunciationInput {
  text: string;
  pinyin: string | null;
}

export interface PronunciationController {
  activate(questionId: string, input: PronunciationInput): void;
  prepare(questionId: string): void;
  reveal(questionId: string): void;
  /** 동기 클릭 경로에 쓸 수 있는 명령. */
  replay(questionId: string): void;
  stop(reason: "advance" | "hidden" | "exit"): void;
  dispose(): void;
  getSnapshot(): PronunciationSnapshot;
  subscribe(listener: (snapshot: PronunciationSnapshot) => void): () => void;
}

export interface PronunciationBinding {
  snapshot: PronunciationSnapshot;
  prepare(): void;
  reveal(): void;
  replay(): void;
}

export interface PronunciationButtonProps {
  snapshot: PronunciationSnapshot;
  replay(): void;
  /** compact: 병음 옆 30px 원(#169). 진행 상태 문구는 스크린리더 전용, 오류 문구만 버튼 아래에 띄운다. */
  size?: "default" | "compact";
}
