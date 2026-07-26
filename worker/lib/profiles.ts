/**
 * 프로필 구성 파서 — Worker 시크릿 `PROFILES`(JSON 배열)를 파싱·검증하고 isolate 수명
 * 동안 캐시한다 (범용화 PRD `docs/PRD-general.md` §3). 여기는 순수 로직만 둔다 —
 * 비밀번호 → 프로필 해석(resolveProfile)과 설정 오류의 500 변환은 후속 이슈에서 배선한다.
 *
 * 오류 메시지에는 비밀번호 값을 절대 싣지 않는다 — 프로필 지목은 비밀이 아닌 `id`로만 한다.
 */

export type QuizMode = "m1" | "m2";
export type ContentType = "zh" | "generic";

export interface Profile {
  /** 전 프로필 유일 슬러그. 재시도 큐 태깅·로그 식별용 — 한 번 정하면 바꾸지 않는다. */
  id: string;
  /** UI 표시명 (홈 화면 표기). */
  name: string;
  /** 전 프로필 유일, 빈 문자열 금지. 인증 겸 프로필 선택. */
  password: string;
  /** 이 프로필의 모든 Sheets 호출 대상 스프레드시트 ID. */
  sheetId: string;
  /** 활성 모드 집합 M — "m1"/"m2"의 비어 있지 않은 부분집합, 중복 없음. */
  modes: QuizMode[];
  /** 콘텐츠 타입 — 생략 시 "zh" (폴백 프로필 포함 하위 호환). */
  contentType: ContentType;
}

/** API 응답에 싣는 공개 프로필 블록 (PRD-general §5.2) — health가 쓰고, words가 후속 이슈에서 재사용. */
export type PublicProfile = Pick<Profile, "id" | "name" | "modes" | "contentType">;

/**
 * 응답용 공개 필드만 추린다 — `sheetId`·`password`는 어떤 API 응답에도 싣지 않는다는
 * 불변식(§5.2)을 이 한 곳에서 보장한다. modes는 복사해 캐시된 프로필과의 참조 공유를 끊는다.
 */
export function toPublicProfile(profile: Profile): PublicProfile {
  return {
    id: profile.id,
    name: profile.name,
    modes: [...profile.modes],
    contentType: profile.contentType,
  };
}

/**
 * 이 모듈이 읽는 env 조각. 생성 파일(worker-configuration.d.ts)에는 `PROFILES` 시크릿이
 * 아직 없으므로(미설정 상태에서는 `wrangler types`가 만들지 않음) 필요한 필드만 구조적으로
 * 선언한다 — 실제 `Env`는 그대로 대입 가능하고, 시크릿 설정 후 재생성돼도 충돌하지 않는다.
 */
export interface ProfilesEnv {
  PROFILES?: string;
  APP_PASSWORD?: string;
  SHEET_ID?: string;
}

/** 설정 오류를 비밀번호 불일치(401)와 구분해 500으로 관측하기 위한 전용 오류 (PRD-general §3.2). */
export class ProfileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileConfigError";
  }
}

// 파싱·검증 결과는 isolate 수명 동안 바뀌지 않으므로 요청마다 재계산하지 않는다
// (auth.ts의 비밀번호 다이제스트 캐시와 같은 패턴). 실패는 캐시하지 않는다 —
// 설정 오류는 매 호출 다시 던져 fail closed를 유지한다.
let cachedProfiles: Profile[] | null = null;

export function getProfiles(env: ProfilesEnv): Profile[] {
  if (!cachedProfiles) {
    cachedProfiles = parseProfiles(env);
  }
  return cachedProfiles;
}

/** 캐시 없는 순수 파싱·검증·폴백 합성. 검증 실패는 전부 ProfileConfigError로 던진다. */
export function parseProfiles(env: ProfilesEnv): Profile[] {
  if (!env.PROFILES) {
    return [synthesizeFallbackProfile(env)];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(env.PROFILES);
  } catch {
    // V8의 SyntaxError 메시지는 소스 일부를 인용한다 — 비밀번호가 로그로 새지 않도록
    // 원인 메시지를 버리고 고정 문구로만 던진다.
    throw new ProfileConfigError("PROFILES가 유효한 JSON이 아닙니다");
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProfileConfigError("PROFILES는 비어 있지 않은 JSON 배열이어야 합니다");
  }
  const profiles = raw.map(parseProfileEntry);
  assertUniqueAcrossProfiles(profiles);
  return profiles;
}

/**
 * PRD-general §3.2 폴백: `PROFILES` 미설정이면 기존 `APP_PASSWORD`+`SHEET_ID`로 단일
 * 프로필을 합성한다 — Workers Builds 자동 배포(#67)와 시크릿 설정 간 순서 제약을 없애고
 * 코드 롤백을 안전하게 한다. 운영 전환 완료 후 정리 단계(§9)에서 구 변수와 함께 제거한다.
 */
function synthesizeFallbackProfile(env: ProfilesEnv): Profile {
  if (!env.APP_PASSWORD || !env.SHEET_ID) {
    const missing = [
      ...(env.APP_PASSWORD ? [] : ["APP_PASSWORD"]),
      ...(env.SHEET_ID ? [] : ["SHEET_ID"]),
    ];
    throw new ProfileConfigError(
      `PROFILES가 설정되지 않았고, 폴백 합성에 필요한 ${missing.join("·")}도 없습니다`,
    );
  }
  return {
    id: "default",
    name: "단어 암기",
    password: env.APP_PASSWORD,
    sheetId: env.SHEET_ID,
    modes: ["m1", "m2"],
    contentType: "zh",
  };
}

function parseProfileEntry(item: unknown, index: number): Profile {
  const label = `PROFILES[${index}]`;
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new ProfileConfigError(`${label}: 프로필은 객체여야 합니다`);
  }
  const { id, name, password, sheetId, modes, contentType } = item as Record<string, unknown>;
  if (typeof id !== "string" || id === "") {
    throw new ProfileConfigError(`${label}: id는 비어 있지 않은 문자열이어야 합니다`);
  }
  const ref = `${label}(${id})`;
  if (typeof name !== "string" || name === "") {
    throw new ProfileConfigError(`${ref}: name은 비어 있지 않은 문자열이어야 합니다`);
  }
  if (typeof password !== "string" || password === "") {
    throw new ProfileConfigError(`${ref}: password는 비어 있지 않은 문자열이어야 합니다`);
  }
  if (typeof sheetId !== "string" || sheetId === "") {
    throw new ProfileConfigError(`${ref}: sheetId는 비어 있지 않은 문자열이어야 합니다`);
  }
  // 알 수 없는 여분 필드는 버리고 알려진 필드만으로 새 객체를 만든다 (전방 호환).
  return {
    id,
    name,
    password,
    sheetId,
    modes: parseModes(modes, ref),
    contentType: parseContentType(contentType, ref),
  };
}

function parseModes(modes: unknown, ref: string): QuizMode[] {
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new ProfileConfigError(`${ref}: modes는 비어 있지 않은 배열이어야 합니다`);
  }
  for (const mode of modes) {
    if (mode !== "m1" && mode !== "m2") {
      throw new ProfileConfigError(`${ref}: modes에는 "m1"/"m2"만 넣을 수 있습니다`);
    }
  }
  if (new Set(modes).size !== modes.length) {
    throw new ProfileConfigError(`${ref}: modes에 중복 값이 있습니다`);
  }
  return modes as QuizMode[];
}

function parseContentType(contentType: unknown, ref: string): ContentType {
  if (contentType === undefined) {
    return "zh";
  }
  if (contentType !== "zh" && contentType !== "generic") {
    throw new ProfileConfigError(`${ref}: contentType은 "zh" 또는 "generic"이어야 합니다`);
  }
  return contentType;
}

function assertUniqueAcrossProfiles(profiles: Profile[]): void {
  const seenIds = new Set<string>();
  // 중복 password 오류는 값 대신 충돌한 두 프로필의 id로 지목한다 — 비밀번호 로그 금지.
  const passwordHolders = new Map<string, string>();
  for (const profile of profiles) {
    if (seenIds.has(profile.id)) {
      throw new ProfileConfigError(`PROFILES: id "${profile.id}"가 중복됩니다`);
    }
    seenIds.add(profile.id);
    const holder = passwordHolders.get(profile.password);
    if (holder !== undefined) {
      throw new ProfileConfigError(
        `PROFILES: 프로필 "${holder}"와 "${profile.id}"의 password가 중복됩니다`,
      );
    }
    passwordHolders.set(profile.password, profile.id);
  }
}
