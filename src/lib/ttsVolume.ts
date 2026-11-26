import type { TtsAudioElement } from "./ttsAudio.ts";

/**
 * 발음 MP3 재생 음량 증폭.
 *
 * 합성 단계 volume은 이미 제공자 최댓값(100, worker/lib/tts/types.ts)이고 `<audio>`의
 * `volume`도 1.0이 상한이라, 더 키우려면 Web Audio 그래프를 거쳐야 한다.
 * `<audio>` → GainNode(증폭) → DynamicsCompressor(리미터, 클리핑 방지) → 출력.
 *
 * AudioContext는 모든 발음 재생이 하나를 공유한다(브라우저별 동시 생성 상한).
 * Web Audio를 쓸 수 없는 환경에서는 증폭 없는 일반 `Audio`로 돌아간다.
 */
export const TTS_PLAYBACK_GAIN = 2.5;

interface BoostGraph {
  context: AudioContext;
  input: AudioNode;
}

let graph: BoostGraph | null | undefined;

function audioContextConstructor(): typeof AudioContext | undefined {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

function resume(context: AudioContext): void {
  if (context.state === "running") return;
  try { void context.resume().catch(() => {}); } catch {}
}

function boostGraph(): BoostGraph | null {
  if (graph !== undefined) return graph;
  graph = null;
  const Context = audioContextConstructor();
  if (!Context) return graph;
  try {
    // iOS에서 Web Audio는 기본적으로 무음 스위치를 따른다. 일반 `<audio>`처럼 무음 모드에서도
    // 들리도록 재생(playback) 세션으로 둔다(Safari 16.4+, 없으면 무시).
    const nav = globalThis.navigator as (Navigator & { audioSession?: { type: string } }) | undefined;
    if (nav?.audioSession) {
      try { nav.audioSession.type = "playback"; } catch {}
    }
    const context = new Context();
    const gain = context.createGain();
    gain.gain.value = TTS_PLAYBACK_GAIN;
    // 증폭으로 0dBFS를 넘는 피크만 눌러 찢어지는 소리를 막는 리미터 설정.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    gain.connect(limiter);
    limiter.connect(context.destination);
    graph = { context, input: gain };
    // 자동 정책상 컨텍스트는 사용자 조작 안에서만 깨어난다. iOS는 백그라운드 뒤
    // "interrupted"로 멈추기도 하므로, 매 조작마다 깨워 타이머 재생(자동 재생)도 소리가 나게 한다.
    if (typeof document !== "undefined") {
      const wake = () => resume(context);
      for (const type of ["pointerdown", "touchend", "keydown"]) {
        document.addEventListener(type, wake, { capture: true, passive: true });
      }
    }
  } catch {
    graph = null;
  }
  return graph;
}

/** 증폭 그래프에 연결된 Audio 요소. 그래프를 못 만들면 일반 Audio다. */
export function createBoostedAudio(): TtsAudioElement {
  const element = new Audio();
  const boost = boostGraph();
  if (!boost) return element;

  let source: MediaElementAudioSourceNode;
  try {
    source = boost.context.createMediaElementSource(element);
    source.connect(boost.input);
  } catch {
    return element;
  }

  const nativePlay = element.play.bind(element);
  const boosted = element as HTMLAudioElement & TtsAudioElement;
  // 재생 호출과 같은 호출 스택에서 깨워야 사용자 조작으로 인정된다.
  boosted.play = () => {
    resume(boost.context);
    return nativePlay();
  };
  boosted.release = () => {
    try { source.disconnect(); } catch {}
  };
  return boosted;
}
