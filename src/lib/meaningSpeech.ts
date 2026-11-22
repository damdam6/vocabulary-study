/**
 * 자동 재생 화면의 한국어 뜻 읽어주기 — 브라우저 내장 음성 합성(Web Speech API)을 쓴다.
 *
 * 중국어 발음(Qwen TTS)과 달리 서버·API 키·과금이 없고 기기에 설치된 한국어 음성으로 읽는다.
 * 그래서 음질과 지원 여부는 기기마다 다르다 — 한국어 음성이 없거나 합성이 실패하면
 * `failed`로 끝내고, 호출한 쪽은 소리 없이 다음 단계로 넘어간다.
 */

export type MeaningSpeechResult = "ended" | "failed";

/** 끝났다는 신호가 오지 않는 브라우저(일부 Chrome)에서 진행이 멈추지 않게 하는 안전장치. */
export const MEANING_SPEECH_TIMEOUT_MS = 15_000;

export function meaningSpeechSupported(): boolean {
  return typeof globalThis.speechSynthesis !== "undefined" && typeof globalThis.SpeechSynthesisUtterance !== "undefined";
}

/**
 * 시트의 뜻 표기를 소리 내어 읽기 좋게 다듬는다.
 * 자리 표시(`~`)는 빼고, 뜻 구분 기호(`/`, `;`)는 쉼표로 바꿔 사이를 끊어 읽게 한다.
 */
export function meaningSpeechText(meaning: string): string {
  return meaning
    .normalize("NFC")
    .replace(/[~～〜]/g, " ")
    .replace(/[/;；·|]/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/(?:\s*,)+/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "");
}

function koreanVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null | undefined {
  let voices: SpeechSynthesisVoice[];
  try { voices = synth.getVoices(); } catch { return undefined; }
  // 목록이 아직 비어 있으면(비동기 로드) 판단할 수 없다 — lang만 지정하고 브라우저에 맡긴다.
  if (voices.length === 0) return undefined;
  const korean = voices.filter((voice) => /^ko\b/i.test(voice.lang.replace("_", "-")));
  if (korean.length === 0) return null;
  return korean.find((voice) => voice.localService) ?? korean[0];
}

/**
 * 뜻을 한국어로 읽는다. 끝나거나 실패하면 `onDone`을 정확히 한 번 부른다.
 * 반환한 함수를 부르면 읽기를 끊고 `onDone`은 부르지 않는다.
 */
export function speakMeaning(meaning: string, onDone: (result: MeaningSpeechResult) => void): () => void {
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = (result: MeaningSpeechResult | null): void => {
    if (finished) return;
    finished = true;
    if (timer !== null) clearTimeout(timer);
    if (result !== null) onDone(result);
  };
  // 실패는 호출 스택 밖에서 알린다 — 호출한 쪽이 반환값(취소 함수)을 받은 뒤에 처리하게 한다.
  const failLater = (): (() => void) => {
    timer = setTimeout(() => finish("failed"), 0);
    return () => finish(null);
  };

  const text = meaningSpeechText(meaning);
  if (!meaningSpeechSupported() || text === "") return failLater();
  const synth = globalThis.speechSynthesis;
  const voice = koreanVoice(synth);
  // 한국어 음성이 없는 기기에서 다른 언어 음성으로 한글을 읽히지 않는다.
  if (voice === null) return failLater();

  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    if (voice) utterance.voice = voice;
    utterance.onend = () => finish("ended");
    utterance.onerror = () => finish("failed");
    // 이전 읽기가 남아 있으면 대기열 뒤에 붙지 않도록 비운다.
    if (synth.speaking || synth.pending) synth.cancel();
    synth.speak(utterance);
  } catch {
    return failLater();
  }
  timer = setTimeout(() => {
    try { synth.cancel(); } catch {}
    finish("failed");
  }, MEANING_SPEECH_TIMEOUT_MS);
  return () => {
    if (finished) return;
    finish(null);
    try { synth.cancel(); } catch {}
  };
}

/**
 * 사용자 조작(자동 재생 시작 탭) 안에서 음성 합성을 한 번 깨워 둔다.
 * iOS Safari는 첫 읽기가 사용자 조작에서 시작돼야 이후 타이머에서 부른 읽기를 허용한다.
 */
export function primeMeaningSpeech(): void {
  if (!meaningSpeechSupported()) return;
  try {
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.lang = "ko-KR";
    utterance.volume = 0;
    globalThis.speechSynthesis.speak(utterance);
  } catch {}
}
