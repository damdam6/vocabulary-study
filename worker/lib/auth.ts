/**
 * `/api/*` 요청 인증 — Authorization: Bearer <비밀번호>를 프로필로 해석한다
 * (PRD-general §6). 비밀번호가 곧 프로필 선택자다.
 */

import { getProfiles, type Profile } from "./profiles.ts";

// 다이제스트는 isolate 수명 동안 바뀌지 않으므로 요청마다 재계산하지 않고 캐시한다.
// 키는 getProfiles가 반환하는 배열 참조 — 파서 캐시(#70)와 수명이 정확히 일치한다.
let digestCache: { profiles: Profile[]; digests: Uint8Array[] } | null = null;

/**
 * Bearer 토큰을 각 프로필 비밀번호의 SHA-256 다이제스트와 상수시간 비교해 첫 일치
 * 프로필을 반환한다 — 비밀번호 유일성은 구성 검증(#70)이 보장하므로 첫 일치가 곧
 * 유일 일치다. 헤더 누락·형식 오류·전 프로필 불일치면 null(→ 401).
 * 구성 오류(ProfileConfigError)는 그대로 전파한다 — 500 변환은 호출자(index.ts) 몫이며,
 * 헤더 검사보다 먼저 던져 설정 사고가 401로 위장되지 않게 한다.
 */
export async function resolveProfile(request: Request, env: Env): Promise<Profile | null> {
  const profiles = getProfiles(env);
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.substring("Bearer ".length);
  const tokenDigest = await sha256(token);
  const digests = await profileDigests(profiles);
  for (let i = 0; i < profiles.length; i++) {
    if (timingSafeEqual(tokenDigest, digests[i])) {
      return profiles[i];
    }
  }
  return null;
}

async function profileDigests(profiles: Profile[]): Promise<Uint8Array[]> {
  if (!digestCache || digestCache.profiles !== profiles) {
    digestCache = {
      profiles,
      digests: await Promise.all(profiles.map((profile) => sha256(profile.password))),
    };
  }
  return digestCache.digests;
}

// 상수 시간(byte XOR) 비교. 두 다이제스트는 항상 SHA-256 고정 길이(32바이트)이므로
// 원본 길이·내용에 따른 타이밍 차이가 생기지 않는다.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}
