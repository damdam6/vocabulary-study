/**
 * 자동 재생 화면이 쓰는 공유 Audio 요소.
 *
 * 모바일 브라우저(특히 iOS Safari)는 사용자 제스처의 호출 스택에서 시작하지 않은
 * `audio.play()`를 막는다. 자동 재생은 발음을 네트워크로 받은 뒤 재생하므로 첫 재생부터
 * 제스처 밖이다. 대신 한 번 제스처 안에서 재생된 요소는 이후 src를 바꿔도 코드로 재생할
 * 수 있으므로, 진입 버튼 클릭에서 이 요소로 무음을 한 번 재생해 풀어 둔다.
 */
let shared: HTMLAudioElement | null = null;
let silentUrl: string | null = null;

export function getSharedTtsAudio(): HTMLAudioElement {
  return (shared ??= new Audio());
}

/** 8kHz 8bit 모노 무음 0.05초 WAV. */
function silentWavUrl(): string {
  if (silentUrl !== null) return silentUrl;
  const samples = 400;
  const bytes = new Uint8Array(44 + samples).fill(0x80, 44);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  silentUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  return silentUrl;
}

/** 반드시 클릭 핸들러의 동기 경로에서 호출한다. 실패해도 조용히 넘어간다. */
export function unlockSharedTtsAudio(): void {
  try {
    const audio = getSharedTtsAudio();
    audio.src = silentWavUrl();
    void Promise.resolve(audio.play()).catch(() => undefined);
  } catch {
    // 풀지 못해도 자동 재생 화면의 "재생" 버튼이 수동 재생으로 대신한다.
  }
}
