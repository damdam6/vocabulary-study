import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTS_REVISION,
  TTS_ADAPTER_VERSION,
  TTS_AUDIO_SETTINGS,
  TTS_ENDPOINT,
  TTS_MODEL,
  TTS_UPGRADE_ENDPOINT,
} from "./types.ts";
import { resolveTtsConfig } from "./config.ts";

const audio = { get() {}, put() {} };
const readyEnv = { TTS_ENABLED: "true", DASHSCOPE_API_KEY: "secret-for-test-only", TTS_AUDIO: audio };

describe("resolveTtsConfig", () => {
  it("생략과 문자열 false는 기능만 비활성화한다", () => {
    expect(resolveTtsConfig({})).toEqual({ status: "disabled", code: "tts_disabled" });
    expect(resolveTtsConfig({ TTS_ENABLED: "false" })).toEqual({ status: "disabled", code: "tts_disabled" });
  });

  it("true 외 flag는 설정 오류다", () => {
    expect(resolveTtsConfig({ TTS_ENABLED: "TRUE" })).toEqual({ status: "not_configured", code: "tts_not_configured" });
    expect(resolveTtsConfig({ TTS_ENABLED: "" })).toEqual({ status: "not_configured", code: "tts_not_configured" });
  });

  it("선택 설정 생략 시 확정 기본값과 불변 튜플을 쓴다", () => {
    const result = resolveTtsConfig(readyEnv);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.config).toMatchObject({ model: TTS_MODEL, rate: 1, revision: DEFAULT_TTS_REVISION, endpoint: TTS_ENDPOINT, upgradeEndpoint: TTS_UPGRADE_ENDPOINT, adapterVersion: TTS_ADAPTER_VERSION });
    expect(result.config.audioSettings).toBe(TTS_AUDIO_SETTINGS);
    expect(result.dependencies.apiKey).toBe("secret-for-test-only");
  });

  it("빈 override와 allowlist 밖 provider/model/voice를 기본값으로 숨기지 않는다", () => {
    for (const vars of [
      { TTS_PROVIDER: "" }, { TTS_PROVIDER: "other" }, { TTS_MODEL: "" }, { TTS_MODEL: "other" }, { TTS_VOICE: "" }, { TTS_VOICE: "other" },
    ]) {
      expect(resolveTtsConfig({ ...readyEnv, ...vars })).toMatchObject({ status: "not_configured" });
    }
  });

  it("rate는 완전한 유한 십진수 범위만 허용한다", () => {
    for (const value of ["0.5", "1", "1.25", "2", "2.0"]) {
      expect(resolveTtsConfig({ ...readyEnv, TTS_RATE: value })).toMatchObject({ status: "ready" });
    }
    for (const value of ["", "0.49", "2.01", "1x", "1e0", "NaN", "Infinity", " 1", "1 "]) {
      expect(resolveTtsConfig({ ...readyEnv, TTS_RATE: value })).toMatchObject({ status: "not_configured" });
    }
  });

  it("revision·키·R2 binding을 엄격히 검사하고 비밀은 오류 결과에 싣지 않는다", () => {
    for (const revision of ["", "has/slash", "line\nbreak", "a".repeat(65)]) {
      expect(resolveTtsConfig({ ...readyEnv, TTS_REVISION: revision })).toMatchObject({ status: "not_configured" });
    }
    expect(resolveTtsConfig({ ...readyEnv, DASHSCOPE_API_KEY: "  " })).toMatchObject({ status: "not_configured" });
    expect(resolveTtsConfig({ ...readyEnv, TTS_AUDIO: { get() {} } as unknown as typeof audio })).toMatchObject({ status: "not_configured" });
  });
});
