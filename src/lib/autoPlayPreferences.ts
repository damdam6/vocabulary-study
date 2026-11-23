/** 브라우저·프로필별 자동 재생 화면의 반복 재생 선호. 기본은 끔(목록을 한 번만 재생). */
const key = (profileId: string) => `vocab-study:autoplay-repeat:${encodeURIComponent(profileId)}`;

export function readAutoPlayRepeat(profileId: string): boolean {
  try { return localStorage.getItem(key(profileId)) === "true"; }
  catch { return false; }
}

/** 저장에 실패해도 이번 재생에는 선택이 그대로 적용된다. */
export function saveAutoPlayRepeat(profileId: string, enabled: boolean): void {
  try { localStorage.setItem(key(profileId), String(enabled)); }
  catch { /* 이번 재생에만 적용 */ }
}

/** 발음이 끝난 뒤 다음 단어로 넘어가기 전 대기 시간(초). 기본이자 최솟값은 2초. */
export const AUTO_PLAY_GAP_DEFAULT_SECONDS = 2;
export const AUTO_PLAY_GAP_MIN_SECONDS = 2;
export const AUTO_PLAY_GAP_MAX_SECONDS = 30;

const gapKey = (profileId: string) => `vocab-study:autoplay-gap:${encodeURIComponent(profileId)}`;

export function clampAutoPlayGapSeconds(value: number): number {
  if (!Number.isFinite(value)) return AUTO_PLAY_GAP_DEFAULT_SECONDS;
  return Math.min(AUTO_PLAY_GAP_MAX_SECONDS, Math.max(AUTO_PLAY_GAP_MIN_SECONDS, Math.round(value)));
}

export function readAutoPlayGapSeconds(profileId: string): number {
  try {
    const raw = localStorage.getItem(gapKey(profileId));
    return raw === null ? AUTO_PLAY_GAP_DEFAULT_SECONDS : clampAutoPlayGapSeconds(Number(raw));
  } catch { return AUTO_PLAY_GAP_DEFAULT_SECONDS; }
}

export function saveAutoPlayGapSeconds(profileId: string, seconds: number): void {
  try { localStorage.setItem(gapKey(profileId), String(clampAutoPlayGapSeconds(seconds))); }
  catch { /* 이번 재생에만 적용 */ }
}

/** 표제어 발음 뒤에 뜻을 한국어로 읽어 줄지. 기본은 켬 — 기기에 한국어 음성이 없으면 조용히 건너뛴다. */
const meaningKey = (profileId: string) => `vocab-study:autoplay-meaning:${encodeURIComponent(profileId)}`;

export function readAutoPlaySpeakMeaning(profileId: string): boolean {
  try { return localStorage.getItem(meaningKey(profileId)) !== "false"; }
  catch { return true; }
}

export function saveAutoPlaySpeakMeaning(profileId: string, enabled: boolean): void {
  try { localStorage.setItem(meaningKey(profileId), String(enabled)); }
  catch { /* 이번 재생에만 적용 */ }
}

/** 표제어 발음(중국어)을 자동으로 읽어 줄지. 기본은 켬. */
const headwordKey = (profileId: string) => `vocab-study:autoplay-headword:${encodeURIComponent(profileId)}`;

export function readAutoPlaySpeakHeadword(profileId: string): boolean {
  try { return localStorage.getItem(headwordKey(profileId)) !== "false"; }
  catch { return true; }
}

export function saveAutoPlaySpeakHeadword(profileId: string, enabled: boolean): void {
  try { localStorage.setItem(headwordKey(profileId), String(enabled)); }
  catch { /* 이번 재생에만 적용 */ }
}
