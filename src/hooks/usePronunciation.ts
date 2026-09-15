import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supportsPronunciation } from "../lib/contentLabels.ts";
import { createPronunciationController } from "../lib/speak.ts";
import { createTtsAudioOutput } from "../lib/ttsAudio.ts";
import { fetchTtsAudio } from "../lib/ttsApi.ts";
import { createTtsBlobCache } from "../lib/ttsBlobCache.ts";
import type {
  PronunciationBinding,
  PronunciationController,
  PronunciationInput,
  PronunciationSnapshot,
  TtsCapability,
} from "../lib/ttsTypes.ts";
import type { ContentType } from "../lib/api.ts";

export interface UsePronunciationOptions {
  profileId: string;
  contentType: ContentType;
  capability: TtsCapability;
  questionId: string | null;
  input: PronunciationInput | null;
}

export interface UsePronunciationResult {
  pronunciation: PronunciationBinding | undefined;
  stop(reason: "advance" | "hidden" | "exit"): void;
}

const EMPTY_SNAPSHOT: PronunciationSnapshot = {
  status: "idle",
  questionId: null,
  enabled: false,
  inputReason: null,
  message: null,
};

/**
 * Study 수명에만 controller와 그 하위 Audio/Blob cache를 묶는다. 렌더 과정에서는
 * 브라우저 자원을 만들지 않아 StrictMode의 setup → cleanup → setup에서도 폐기된
 * controller가 다음 setup을 막지 않는다.
 */
export function usePronunciation({
  profileId,
  contentType,
  capability,
  questionId,
  input,
}: UsePronunciationOptions): UsePronunciationResult {
  const controllerRef = useRef<PronunciationController | null>(null);
  const hiddenRef = useRef(false);
  const [isHidden, setIsHidden] = useState(false);
  const [controller, setController] = useState<PronunciationController | null>(null);
  const [snapshot, setSnapshot] = useState<PronunciationSnapshot>(EMPTY_SNAPSHOT);
  const supported = supportsPronunciation(contentType) && capability.enabled;
  const revision = capability.enabled ? capability.revision : "";
  const maxTextLength = capability.enabled ? capability.maxTextLength : 0;
  const inputText = input?.text ?? null;
  const inputPinyin = input?.pinyin ?? null;

  useLayoutEffect(() => {
    if (!supported) {
      controllerRef.current = null;
      setController(null);
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    const next = createPronunciationController({
      profileId,
      capability,
      transport: fetchTtsAudio,
      audio: createTtsAudioOutput(),
      cache: createTtsBlobCache(),
    });
    controllerRef.current = next;
    const unsubscribe = next.subscribe((nextSnapshot) => {
      if (controllerRef.current === next) setSnapshot(nextSnapshot);
    });
    setSnapshot(next.getSnapshot());
    setController(next);

    return () => {
      unsubscribe();
      next.stop("exit");
      next.dispose();
      if (controllerRef.current === next) controllerRef.current = null;
      setController((current) => current === next ? null : current);
    };
  // capability is represented by its immutable server values, not object identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, supported, revision, maxTextLength]);

  useLayoutEffect(() => {
    if (controller === null || questionId === null || inputText === null) return;
    controller.activate(questionId, { text: inputText, pinyin: inputPinyin });
    if (controllerRef.current === controller) setSnapshot(controller.getSnapshot());
  }, [controller, inputPinyin, inputText, questionId]);

  useLayoutEffect(() => {
    if (controller === null) return;
    const stopWhenHidden = () => {
      hiddenRef.current = true;
      setIsHidden(true);
      controller.stop("hidden");
      if (controllerRef.current === controller) setSnapshot(controller.getSnapshot());
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopWhenHidden();
      } else if (hiddenRef.current) {
        // 복귀는 재활성화나 자동 재생이 아니다. 다음 수동 명령만 허용한다.
        hiddenRef.current = false;
        setIsHidden(false);
      }
    };
    if (document.visibilityState === "hidden") stopWhenHidden();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", stopWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", stopWhenHidden);
    };
  }, [controller]);

  const stop = useCallback((reason: "advance" | "hidden" | "exit") => {
    if (reason === "hidden") {
      hiddenRef.current = true;
      setIsHidden(true);
    }
    const current = controllerRef.current;
    if (current === null) return;
    current.stop(reason);
    setSnapshot(current.getSnapshot());
  }, []);

  const pronunciation = useMemo<PronunciationBinding | undefined>(() => {
    if (controller === null || questionId === null || !snapshot.enabled || isHidden) return undefined;
    const currentQuestionId = questionId;
    if (snapshot.questionId !== currentQuestionId) return undefined;
    const callCurrent = (command: (id: string) => void) => () => {
      if (hiddenRef.current || controllerRef.current !== controller || controller.getSnapshot().questionId !== currentQuestionId) return;
      command(currentQuestionId);
    };
    return {
      snapshot,
      prepare: callCurrent((id) => controller.prepare(id)),
      reveal: callCurrent((id) => controller.reveal(id)),
      replay: callCurrent((id) => controller.replay(id)),
    };
  }, [controller, isHidden, questionId, snapshot]);

  return { pronunciation, stop };
}
