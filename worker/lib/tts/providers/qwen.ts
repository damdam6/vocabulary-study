import {
  TTS_ERROR_RESPONSES,
  type TtsConfig,
  type TtsErrorCode,
  type TtsProvider,
} from "../types.ts";
import { createQwenClientMessages, createQwenEventProcessor, type QwenEventProcessor } from "./qwenProtocol.ts";

type ProviderErrorCode = Extract<TtsErrorCode, "tts_unavailable" | "tts_upstream_error">;

export interface QwenUpgradeResponse {
  status: number;
  webSocket: QwenWebSocket | null;
}

export interface QwenWebSocket {
  binaryType: string;
  accept(): void;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close" | "error", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "close" | "error", listener: () => void): void;
}

export interface QwenProviderOptions {
  fetch?: (input: string, init: RequestInit) => Promise<QwenUpgradeResponse>;
  randomUUID?: () => string;
}

/** 제공자 세부 정보를 공개하지 않는 adapter 전용 오류. */
export class QwenTtsError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;

  constructor(code: ProviderErrorCode) {
    super(TTS_ERROR_RESPONSES[code].message);
    this.name = "QwenTtsError";
    this.code = code;
    this.status = TTS_ERROR_RESPONSES[code].status;
  }
}

/**
 * Workers Upgrade fetch와 순수 Qwen protocol 처리기를 연결한다. 호출별로 socket과
 * task를 새로 만들며, deadline·재시도·서비스 정책은 상위 계층의 책임으로 남긴다.
 */
export function createQwenTtsProvider(
  config: TtsConfig,
  apiKey: string,
  options: QwenProviderOptions = {},
): TtsProvider {
  const upgradeFetch = options.fetch ?? defaultUpgradeFetch;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());

  return {
    pronunciationMode: "none",
    synthesize(input, signal) {
      if (signal.aborted) return Promise.reject(signal.reason);

      return new Promise((resolve, reject) => {
        let terminal = false;
        let socket: QwenWebSocket | undefined;
        let processor: QwenEventProcessor | undefined;
        let messages: ReturnType<typeof createQwenClientMessages> | undefined;
        let taskOpened = false;
        let inputSent = false;
        let listenersAttached = false;
        let socketAccepted = false;

        const onMessage = (event: { data: unknown }) => {
          if (terminal || !processor) return;
          const data = event.data;
          const update = typeof data === "string"
            ? processor.push(data)
            : data instanceof ArrayBuffer
              ? processor.push(new Uint8Array(data))
              : { status: "failed" as const, code: "tts_upstream_error" as const };
          if (update.status === "failed") {
            fail(update.code);
            return;
          }
          if (update.status === "completed") {
            succeed(update.billedCharacters === undefined
              ? { audio: update.audio, contentType: update.contentType }
              : { audio: update.audio, contentType: update.contentType, billedCharacters: update.billedCharacters });
            return;
          }
          // 시작 전 유일한 정상 pending은 qwenProtocol의 task-started다.
          if (!inputSent) {
            inputSent = true;
            try {
              socket!.send(messages!.continueTask);
              if (terminal) return;
              socket!.send(messages!.finishTask);
            } catch {
              fail("tts_upstream_error");
            }
          }
        };
        const onClose = () => {
          if (terminal) return;
          const update = processor?.end();
          fail(update?.status === "failed" ? update.code : "tts_upstream_error");
        };
        const onError = () => fail("tts_upstream_error");
        const removeListeners = () => {
          if (!socket || !listenersAttached) return;
          listenersAttached = false;
          try { socket.removeEventListener("message", onMessage); } catch { /* cleanup only */ }
          try { socket.removeEventListener("close", onClose); } catch { /* cleanup only */ }
          try { socket.removeEventListener("error", onError); } catch { /* cleanup only */ }
        };
        const closeSocket = () => {
          if (!socket) return;
          if (!socketAccepted) {
            try { socket.accept(); } catch { /* already accepted or unusable */ }
          }
          try { socket.close(); } catch { /* preserve original outcome */ }
        };
        const settle = (outcome: { kind: "success"; value: { audio: Uint8Array; contentType: "audio/mpeg"; billedCharacters?: number } } | { kind: "failure"; reason: unknown; cancel: boolean }) => {
          if (terminal) return;
          terminal = true;
          signal.removeEventListener("abort", onAbort);
          removeListeners();
          if (outcome.kind === "failure") {
            if (outcome.cancel && taskOpened && socket && messages) {
              try { socket.send(messages.cancelTask); } catch { /* best effort */ }
            }
            try { processor?.end(); } catch { /* cleanup only */ }
          }
          closeSocket();
          processor = undefined;
          messages = undefined;
          socket = undefined;
          if (outcome.kind === "success") {
            resolve(outcome.value);
          } else {
            reject(outcome.reason);
          }
        };
        const succeed = (value: { audio: Uint8Array; contentType: "audio/mpeg"; billedCharacters?: number }) => settle({ kind: "success", value });
        const fail = (code: ProviderErrorCode) => settle({ kind: "failure", reason: new QwenTtsError(code), cancel: false });
        const onAbort = () => settle({ kind: "failure", reason: signal.reason, cancel: true });
        const disposeUpgradeSocket = (lateSocket: QwenWebSocket | null) => {
          if (!lateSocket) return;
          try { lateSocket.accept(); } catch { /* already accepted or unusable */ }
          try { lateSocket.close(); } catch { /* cleanup only */ }
        };
        const start = (response: QwenUpgradeResponse) => {
          if (terminal) {
            disposeUpgradeSocket(response.webSocket);
            return;
          }
          if (response.status !== 101 || !response.webSocket) {
            disposeUpgradeSocket(response.webSocket);
            fail(response.status === 401 || response.status === 403 || response.status === 429 ? "tts_unavailable" : "tts_upstream_error");
            return;
          }
          socket = response.webSocket;
          try {
            socket.binaryType = "arraybuffer";
            listenersAttached = true;
            socket.addEventListener("message", onMessage);
            socket.addEventListener("close", onClose);
            socket.addEventListener("error", onError);
            if (terminal) return;
            socket.accept();
            socketAccepted = true;
            if (terminal) return;
            const taskId = randomUUID();
            processor = createQwenEventProcessor(taskId);
            messages = createQwenClientMessages(taskId, config, input);
            taskOpened = true;
            socket.send(messages.runTask);
          } catch {
            fail("tts_upstream_error");
          }
        };

        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
          return;
        }
        let pendingUpgrade: Promise<QwenUpgradeResponse>;
        try {
          pendingUpgrade = upgradeFetch(config.upgradeEndpoint, {
            method: "GET",
            headers: { Upgrade: "websocket", Authorization: `Bearer ${apiKey}` },
            redirect: "manual",
            signal,
          });
        } catch {
          fail("tts_upstream_error");
          return;
        }
        pendingUpgrade.then(start, () => fail("tts_upstream_error"));
      });
    },
  };
}

function defaultUpgradeFetch(input: string, init: RequestInit): Promise<QwenUpgradeResponse> {
  return fetch(input, init) as Promise<unknown> as Promise<QwenUpgradeResponse>;
}
