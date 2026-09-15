import type { TtsAudioOutput, TtsAudioOutputEvent, TtsPlayResult } from "./ttsTypes.ts";

/** 테스트 더블과 브라우저 Audio가 공유하는, 이 모듈이 실제로 쓰는 최소 표면이다. */
export interface TtsAudioElement {
  currentTime: number;
  ended: boolean;
  error: unknown;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: "ended" | "error", listener: () => void): void;
  removeEventListener(type: "ended" | "error", listener: () => void): void;
}

export interface TtsAudioOutputDependencies {
  createAudio?: () => TtsAudioElement;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

interface Source {
  readonly generation: number;
  url: string;
  settled: boolean;
  started: boolean;
  active: boolean;
  resolve(result: TtsPlayResult): void;
  onEnded: () => void;
  onError: () => void;
}

function isNotAllowedError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "NotAllowedError";
}

/**
 * 하나의 Audio 요소만 소유하는 TTS 출력기.
 *
 * `play`는 URL을 연결한 뒤 같은 호출 스택에서 native `audio.play()`를 시작한다.
 * 각 source는 URL과 listener를 소유하므로 이전 재생의 Promise·이벤트는 새 재생을
 * 정리하거나 통지할 수 없다. 브라우저 전역은 인스턴스 생성만으로 평가하지 않는다.
 */
export function createTtsAudioOutput(dependencies: TtsAudioOutputDependencies = {}): TtsAudioOutput {
  const createAudio = dependencies.createAudio ?? (() => new Audio());
  const createObjectURL = dependencies.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectURL = dependencies.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));

  let audio: TtsAudioElement | undefined;
  let current: Source | undefined;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<(event: TtsAudioOutputEvent) => void>();

  const isCurrent = (source: Source): boolean => current === source && source.active;

  const settle = (source: Source, result: TtsPlayResult): void => {
    if (source.settled) return;
    source.settled = true;
    source.resolve(result);
  };

  const detach = (source: Source): void => {
    if (!source.active) return;
    source.active = false;
    if (current === source) current = undefined;

    const element = audio;
    if (element) {
      try { element.removeEventListener("ended", source.onEnded); } catch {}
      try { element.removeEventListener("error", source.onError); } catch {}
      // detach → load before revocation prevents an element from retaining the Blob URL.
      try { element.pause(); } catch {}
      try { element.removeAttribute("src"); } catch {}
      try { element.load(); } catch {}
    }

    const url = source.url;
    source.url = "";
    if (url) {
      try { revokeObjectURL(url); } catch {}
    }
  };

  const cancel = (source: Source): void => {
    settle(source, { status: "cancelled" });
    detach(source);
  };

  const emit = (event: TtsAudioOutputEvent): void => {
    for (const listener of [...listeners]) {
      try { listener(event); } catch {}
    }
  };

  const attached = (source: Source): boolean =>
    isCurrent(source) && source.url !== "" && audio?.getAttribute("src") === source.url;

  return {
    play(blob) {
      if (disposed) return Promise.resolve({ status: "cancelled" });

      if (current) cancel(current);

      let element: TtsAudioElement;
      try {
        element = audio ??= createAudio();
      } catch (error) {
        return Promise.resolve({ status: "error", error });
      }

      let url: string;
      try {
        url = createObjectURL(blob);
      } catch (error) {
        return Promise.resolve({ status: "error", error });
      }

      let resolve!: (result: TtsPlayResult) => void;
      const result = new Promise<TtsPlayResult>((done) => { resolve = done; });
      const source: Source = {
        generation: ++generation,
        url,
        settled: false,
        started: false,
        active: true,
        resolve,
        onEnded: () => {},
        onError: () => {},
      };

      source.onEnded = () => {
        if (!attached(source) || element.ended !== true) return;
        settle(source, { status: "cancelled" });
        detach(source);
        emit("ended");
      };
      source.onError = () => {
        if (!attached(source) || element.error == null) return;
        const error = element.error;
        if (source.started) {
          detach(source);
          emit("error");
        } else {
          settle(source, { status: "error", error });
          detach(source);
        }
      };

      current = source;
      try {
        element.addEventListener("ended", source.onEnded);
        element.addEventListener("error", source.onError);
        element.setAttribute("src", url);
        element.currentTime = 0;
        // Do not put an await, a microtask, or a readiness event before this call.
        const nativePlay = element.play();
        void Promise.resolve(nativePlay).then(
          () => {
            if (!isCurrent(source)) return;
            source.started = true;
            settle(source, { status: "started" });
          },
          (error: unknown) => {
            if (!isCurrent(source)) return;
            settle(source, isNotAllowedError(error) ? { status: "blocked" } : { status: "error", error });
            detach(source);
          },
        );
      } catch (error) {
        settle(source, { status: "error", error });
        detach(source);
      }
      return result;
    },

    stop() {
      if (current) cancel(current);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (current) cancel(current);
      listeners.clear();
    },

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
