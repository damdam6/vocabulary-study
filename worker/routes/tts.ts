/**
 * 인증을 마친 TTS HTTP 경계. 입력·설정·서비스 정책은 각각의 전용 모듈에 남기고,
 * 이 파일은 순서 고정, ExecutionContext 연결, 공개 응답 직렬화만 담당한다.
 */
import { resolveTtsConfig } from "../lib/tts/config.ts";
import { readTtsRequest, TtsInputError } from "../lib/tts/input.ts";
import { createQwenTtsProvider } from "../lib/tts/providers/qwen.ts";
import { createR2TtsAudioService, TtsServiceError } from "../lib/tts/service.ts";
import type { TtsAudioStorageBucket } from "../lib/tts/storage.ts";
import {
  TTS_ERROR_RESPONSES,
  TTS_RESPONSE_HEADERS,
  type TtsErrorCode,
  type TtsWorkerEnv,
} from "../lib/tts/types.ts";
import type { Profile } from "../lib/profiles.ts";

export async function handleTtsPost(
  request: Request,
  env: TtsWorkerEnv,
  profile: Profile,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") return ttsError("method_not_allowed", { Allow: "POST" });
  if (profile.contentType !== "zh") return ttsError("tts_not_allowed");

  const resolved = resolveTtsConfig(env);
  if (resolved.status !== "ready") return ttsError(resolved.code);
  if (!isJsonContentType(request.headers.get("content-type"))) return ttsError("unsupported_media_type");

  let input;
  try {
    input = await readTtsRequest(request);
  } catch (error) {
    if (error instanceof TtsInputError) return ttsError(error.code);
    throw error;
  }

  if (request.signal.aborted) throw request.signal.reason;
  const requestId = crypto.randomUUID();
  const provider = createQwenTtsProvider(resolved.config, resolved.dependencies.apiKey);
  // Env의 최소 binding 계약을 실제 R2 저장소 표면으로 좁히는 유일한 조합 지점이다.
  const service = createR2TtsAudioService(resolved.dependencies.audio as unknown as TtsAudioStorageBucket, {
    provider,
    createRequestId: () => requestId,
    registerBackgroundTask: (task) => ctx?.waitUntil(task),
  });

  try {
    const result = await service({
      profile: { id: profile.id, sheetId: profile.sheetId },
      input,
      config: resolved.config,
      signal: request.signal,
    });
    console.info("tts_response", {
      requestId,
      profileId: profile.id,
      provider: resolved.config.provider,
      model: resolved.config.model,
      revision: result.revision,
      characterCount: Array.from(input.text).length,
      billedCharacters: result.billedCharacters,
      pronunciation: result.pronunciation,
      source: result.source,
      storage: result.storage,
      byteLength: result.audio.byteLength,
    });
    return new Response(result.audio.slice().buffer, {
      status: 200,
      headers: {
        "Content-Type": TTS_RESPONSE_HEADERS.contentType,
        "Cache-Control": TTS_RESPONSE_HEADERS.cacheControl,
        "X-Content-Type-Options": TTS_RESPONSE_HEADERS.contentTypeOptions,
        [TTS_RESPONSE_HEADERS.source]: result.source,
        [TTS_RESPONSE_HEADERS.storage]: result.storage,
        [TTS_RESPONSE_HEADERS.pronunciation]: result.pronunciation,
        [TTS_RESPONSE_HEADERS.revision]: result.revision,
      },
    });
  } catch (error) {
    if (request.signal.aborted) throw request.signal.reason;
    if (error instanceof TtsServiceError) return ttsError(error.code);
    return ttsInternalError();
  }
}

export function ttsError(code: TtsErrorCode, extraHeaders: HeadersInit = {}): Response {
  const { status, error, message } = TTS_ERROR_RESPONSES[code];
  return Response.json(
    { error, message },
    { status, headers: { "Cache-Control": TTS_RESPONSE_HEADERS.cacheControl, ...extraHeaders } },
  );
}

/** 서비스에서 분류되지 않은 오류는 가용성 오류와 구분해 고정 500으로 숨긴다. */
function ttsInternalError(): Response {
  const { error, message } = TTS_ERROR_RESPONSES.tts_unavailable;
  return Response.json(
    { error, message },
    { status: 500, headers: { "Cache-Control": TTS_RESPONSE_HEADERS.cacheControl } },
  );
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
