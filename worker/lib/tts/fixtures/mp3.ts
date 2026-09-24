/** 테스트와 저장소/provider 경계에서 재사용하는 최소 MPEG-2 Layer III fixture. */
export function createMp3Fixture(frameCount = 2): Uint8Array {
  const frameLength = 384; // 72 * 128000 / 24000
  const audio = new Uint8Array(frameLength * frameCount);
  for (let offset = 0; offset < audio.length; offset += frameLength) {
    audio.set([0xff, 0xf3, 0xc4, 0x00], offset);
  }
  return audio;
}

export function createId3Mp3Fixture(): Uint8Array {
  const audio = createMp3Fixture(1);
  const result = new Uint8Array(14 + audio.length);
  result.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04]);
  result.set([0x54, 0x45, 0x53, 0x54], 10);
  result.set(audio, 14);
  return result;
}
