/** 브라우저·프로필별 자동 재생 선호. 서버의 TTS 사용 가능 여부와 별개다. */
const key = (profileId: string) => `vocab-study:audio-autoplay:${encodeURIComponent(profileId)}`;

export function readAudioAutoplay(profileId: string): boolean {
  try { return localStorage.getItem(key(profileId)) !== "false"; }
  catch { return true; }
}

/** 저장 실패 시 현재 세션 선택은 유지하고 UI에서 영속 저장 실패를 알린다. */
export function saveAudioAutoplay(profileId: string, enabled: boolean): boolean {
  try {
    localStorage.setItem(key(profileId), String(enabled));
    return true;
  } catch { return false; }
}
