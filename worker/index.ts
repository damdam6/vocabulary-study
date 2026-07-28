import { handleAnswerPost } from "./routes/answer.ts";
import { handleGetWords } from "./routes/words.ts";
import { handleReviewFail } from "./routes/review-fail.ts";
import { handleGetTabs } from "./routes/tabs.ts";
import { handleWordsRegister } from "./routes/register.ts";
import { handleSettingsPost } from "./routes/settings.ts";
import { resolveProfile } from "./lib/auth.ts";
import { ProfileConfigError, toPublicProfile, type Profile } from "./lib/profiles.ts";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 배포 전파 윈도우(신/구 버전 혼재) 중 어떤 버전이 응답했는지 식별하기 위해 노출 (#23)
    const version = env.CF_VERSION_METADATA?.id ?? "unknown";

    // 라우트 디스패치는 인증 블록 안 — 해석된 프로필이 모든 핸들러의 시트 대상을 결정한다 (PRD-general §5.2).
    if (url.pathname.startsWith("/api/")) {
      let profile: Profile | null;
      try {
        profile = await resolveProfile(request, env);
      } catch (err) {
        if (!(err instanceof ProfileConfigError)) {
          throw err;
        }
        // 설정 오류는 비밀번호 불일치(401)와 구분해 500으로 — 설정 사고를 관측 가능하게 (#71)
        console.error("[profiles]", err);
        return Response.json(
          { error: "invalid profile configuration" },
          { status: 500, headers: { "X-Worker-Version": version } },
        );
      }
      if (!profile) {
        return new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": "Bearer", "X-Worker-Version": version },
        });
      }

      if (url.pathname === "/api/health") {
        return Response.json(
          { ok: true, time: new Date().toISOString(), version, profile: toPublicProfile(profile) },
          { headers: { "X-Worker-Version": version } },
        );
      }

      if (url.pathname === "/api/words" && request.method === "GET") {
        try {
          return await handleGetWords(request, env, profile);
        } catch (err) {
          console.error("[GET /api/words]", err);
          return Response.json({ error: "failed to load words" }, { status: 500 });
        }
      }

      if (url.pathname === "/api/answer" && request.method === "POST") {
        try {
          return await handleAnswerPost(request, env, profile);
        } catch (err) {
          console.error("[POST /api/answer]", err);
          return Response.json({ error: "failed to record answer" }, { status: 500 });
        }
      }

      if (url.pathname === "/api/review-fail" && request.method === "POST") {
        try {
          return await handleReviewFail(request, env, profile);
        } catch (err) {
          console.error("[POST /api/review-fail]", err);
          return Response.json({ error: "failed to update review interval" }, { status: 500 });
        }
      }

      if (url.pathname === "/api/tabs" && request.method === "GET") {
        try {
          return await handleGetTabs(request, env, profile);
        } catch (err) {
          console.error("[GET /api/tabs]", err);
          return Response.json({ error: "failed to load tabs" }, { status: 500 });
        }
      }

      if (url.pathname === "/api/words/register" && request.method === "POST") {
        try {
          return await handleWordsRegister(request, env, profile);
        } catch (err) {
          console.error("[POST /api/words/register]", err);
          return Response.json({ error: "failed to register words" }, { status: 500 });
        }
      }

      if (url.pathname === "/api/settings" && request.method === "POST") {
        try {
          return await handleSettingsPost(request, env, profile);
        } catch (err) {
          console.error("[POST /api/settings]", err);
          return Response.json({ error: "failed to save settings" }, { status: 500 });
        }
      }
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
