import { describe, expect, it } from "vitest";
import {
  getProfiles,
  parseProfiles,
  ProfileConfigError,
  toPublicProfile,
  type ProfilesEnv,
} from "./profiles.ts";

function makeProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "zh",
    name: "중국어 단어",
    password: "pw-zh",
    sheetId: "sheet-zh",
    modes: ["m1", "m2"],
    contentType: "zh",
    ...overrides,
  };
}

function envWith(profiles: unknown): { PROFILES: string } {
  return { PROFILES: JSON.stringify(profiles) };
}

describe("parseProfiles — 정상 구성", () => {
  it("2프로필 구성을 그대로 파싱한다", () => {
    const result = parseProfiles(
      envWith([
        makeProfile(),
        makeProfile({ id: "en", name: "영어 표현", password: "pw-en", sheetId: "sheet-en", modes: ["m1"], contentType: "generic" }),
      ]),
    );
    expect(result).toEqual([
      { id: "zh", name: "중국어 단어", password: "pw-zh", sheetId: "sheet-zh", modes: ["m1", "m2"], contentType: "zh" },
      { id: "en", name: "영어 표현", password: "pw-en", sheetId: "sheet-en", modes: ["m1"], contentType: "generic" },
    ]);
  });

  it("contentType 생략 시 'zh' 기본값을 채운다", () => {
    const profile = makeProfile();
    delete profile.contentType;
    const result = parseProfiles(envWith([profile]));
    expect(result[0].contentType).toBe("zh");
  });

  it("알 수 없는 여분 필드는 버린다", () => {
    const result = parseProfiles(envWith([makeProfile({ note: "여분" })]));
    expect(result[0]).toEqual({
      id: "zh",
      name: "중국어 단어",
      password: "pw-zh",
      sheetId: "sheet-zh",
      modes: ["m1", "m2"],
      contentType: "zh",
    });
  });
});

describe("parseProfiles — 설정 오류", () => {
  it("JSON이 깨져 있으면 ProfileConfigError", () => {
    expect(() => parseProfiles({ PROFILES: "[{broken" })).toThrow(ProfileConfigError);
  });

  it("JSON 파싱 오류 메시지에 원문(비밀번호)이 실리지 않는다", () => {
    // V8의 SyntaxError 메시지는 소스 일부를 인용하므로, 고정 문구로 대체됐는지 고정한다.
    let caught: unknown;
    try {
      parseProfiles({ PROFILES: '[{"password": "super-secret-pw"' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileConfigError);
    expect((caught as Error).message).not.toContain("super-secret-pw");
  });

  it("배열이 아니면 ProfileConfigError", () => {
    expect(() => parseProfiles(envWith(makeProfile()))).toThrow(ProfileConfigError);
  });

  it("빈 배열이면 ProfileConfigError", () => {
    expect(() => parseProfiles(envWith([]))).toThrow(ProfileConfigError);
  });

  it.each(["id", "name", "password", "sheetId", "modes"])("%s 누락이면 ProfileConfigError", (field) => {
    const profile = makeProfile();
    delete profile[field];
    expect(() => parseProfiles(envWith([profile]))).toThrow(ProfileConfigError);
  });

  it("password가 빈 문자열이면 ProfileConfigError", () => {
    expect(() => parseProfiles(envWith([makeProfile({ password: "" })]))).toThrow(ProfileConfigError);
  });

  it("password가 중복되면 ProfileConfigError — 메시지에는 값 대신 id만 실린다", () => {
    let caught: unknown;
    try {
      parseProfiles(
        envWith([
          makeProfile({ password: "pw-dup" }),
          makeProfile({ id: "en", sheetId: "sheet-en", password: "pw-dup" }),
        ]),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileConfigError);
    expect((caught as Error).message).not.toContain("pw-dup");
    expect((caught as Error).message).toContain('"zh"');
    expect((caught as Error).message).toContain('"en"');
  });

  it("id가 중복되면 ProfileConfigError", () => {
    const dup = [makeProfile(), makeProfile({ password: "pw-other" })];
    expect(() => parseProfiles(envWith(dup))).toThrow(ProfileConfigError);
  });

  it("modes가 빈 배열이면 ProfileConfigError", () => {
    expect(() => parseProfiles(envWith([makeProfile({ modes: [] })]))).toThrow(ProfileConfigError);
  });

  it("modes에 중복 값이 있으면 ProfileConfigError", () => {
    expect(() => parseProfiles(envWith([makeProfile({ modes: ["m1", "m1"] })]))).toThrow(ProfileConfigError);
  });

  it("modes에 범위 밖 값이 있으면 ProfileConfigError", () => {
    expect(() => parseProfiles(envWith([makeProfile({ modes: ["m1", "m3"] })]))).toThrow(ProfileConfigError);
  });

  it("contentType이 범위 밖 값이면 ProfileConfigError", () => {
    expect(() => parseProfiles(envWith([makeProfile({ contentType: "en" })]))).toThrow(ProfileConfigError);
  });
});

describe("parseProfiles — PROFILES 미설정 (fail closed)", () => {
  it("PROFILES가 없으면 ProfileConfigError — 인증 불능이 아니라 설정 오류", () => {
    expect(() => parseProfiles({})).toThrow(ProfileConfigError);
  });

  it("구 변수(APP_PASSWORD·SHEET_ID)가 있어도 프로필을 합성하지 않는다", () => {
    // 폴백 합성 제거(#82)의 회귀 방지 — 구 시크릿이 환경에 남아 있어도 되살아나면 안 된다.
    const legacyEnv = { APP_PASSWORD: "legacy-pw", SHEET_ID: "legacy-sheet" } as unknown as ProfilesEnv;
    expect(() => parseProfiles(legacyEnv)).toThrow(ProfileConfigError);
  });
});

describe("toPublicProfile", () => {
  it("공개 4필드만 남긴다 — sheetId·password는 키 자체가 없다", () => {
    const [profile] = parseProfiles(envWith([makeProfile()]));
    const publicBlock = toPublicProfile(profile);
    // toEqual은 여분 키도 불일치로 잡는다 — 4필드 외 아무것도 없음을 고정.
    expect(publicBlock).toEqual({
      id: "zh",
      name: "중국어 단어",
      modes: ["m1", "m2"],
      contentType: "zh",
    });
    expect(Object.keys(publicBlock)).not.toContain("sheetId");
    expect(Object.keys(publicBlock)).not.toContain("password");
  });

  it("modes를 복사해 원본 프로필과 참조를 공유하지 않는다", () => {
    const [profile] = parseProfiles(envWith([makeProfile()]));
    const publicBlock = toPublicProfile(profile);
    expect(publicBlock.modes).not.toBe(profile.modes);
    expect(publicBlock.modes).toEqual(profile.modes);
  });
});

describe("getProfiles — isolate 캐시", () => {
  // 모듈 스코프 캐시라 getProfiles는 이 블록에서만 호출한다 — 다른 테스트가 캐시를
  // 채우면 검증이 헛통과한다 (index.test.ts의 다이제스트 캐시 주의와 같은 이유).
  it("재호출 시 재파싱 없이 첫 결과를 그대로 반환한다", () => {
    const first = getProfiles(envWith([makeProfile()]));
    const second = getProfiles(
      envWith([makeProfile({ id: "other", password: "pw-other" })]),
    );
    expect(second).toBe(first); // 동일 참조 — 두 번째 env는 파싱되지 않았다
    expect(second[0].id).toBe("zh");
  });
});
