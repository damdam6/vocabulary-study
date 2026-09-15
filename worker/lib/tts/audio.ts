import { MAX_TTS_AUDIO_BYTES, type ValidateAudio } from "./types.ts";

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
} as const;
const SAMPLE_RATES = {
  1: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  25: [11_025, 12_000, 8_000],
} as const;

/** MIME과 전체 MPEG Layer III frame 경계를 검사하는 동기식 공용 검사기. */
export const validateMp3: ValidateAudio = (audio, contentType) => {
  if (normalizeMime(contentType) !== "audio/mpeg" || audio.length === 0 || audio.length > MAX_TTS_AUDIO_BYTES) {
    return false;
  }

  let offset = id3End(audio);
  if (offset < 0 || offset === audio.length) return false;

  let frames = 0;
  while (offset < audio.length) {
    const length = frameLength(audio, offset);
    if (length === 0 || offset + length > audio.length) return false;
    offset += length;
    frames += 1;
  }
  return frames > 0 && offset === audio.length;
};

function normalizeMime(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function id3End(audio: Uint8Array): number {
  if (audio.length < 3 || audio[0] !== 0x49 || audio[1] !== 0x44 || audio[2] !== 0x33) return 0;
  if (audio.length < 10) return -1;
  const version = audio[3];
  const flags = audio[5];
  const sizeBytes = audio.subarray(6, 10);
  if ((version !== 3 && version !== 4) || flags === undefined || (flags & 0x0f) !== 0 || sizeBytes.some((byte) => byte > 0x7f)) return -1;
  const size = ((sizeBytes[0]! << 21) | (sizeBytes[1]! << 14) | (sizeBytes[2]! << 7) | sizeBytes[3]!) >>> 0;
  const end = 10 + size + (version === 4 && (flags & 0x10) !== 0 ? 10 : 0);
  return end <= audio.length ? end : -1;
}

function frameLength(audio: Uint8Array, offset: number): number {
  if (offset + 4 > audio.length) return 0;
  const first = audio[offset]!;
  const second = audio[offset + 1]!;
  const third = audio[offset + 2]!;
  if (first !== 0xff || (second & 0xe0) !== 0xe0 || (second & 0x06) !== 0x02) return 0;

  const versionBits = (second >> 3) & 0x03;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : versionBits === 0 ? 25 : 0;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  if (version === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return 0;

  const bitrate = BITRATES[version === 1 ? 1 : 2][bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  if (!bitrate || !sampleRate) return 0;
  const padding = (third >> 1) & 1;
  return Math.floor((version === 1 ? 144 : 72) * bitrate * 1000 / sampleRate) + padding;
}
