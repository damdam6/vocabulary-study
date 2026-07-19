import { handleAnswerPost } from "./routes/answer.ts";
import { handleGetWords } from "./routes/words.ts";
import { handleReviewFail } from "./routes/review-fail.ts";
import { handleGetTabs } from "./routes/tabs.ts";
import { handleWordsRegister } from "./routes/register.ts";
import { isAuthorized } from "./lib/auth.ts";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 배포 전파 윈도우(신/구 버전 혼재) 중 어떤 버전이 응답했는지 식별하기 위해 노출 (#23)
    const version = env.CF_VERSION_METADATA?.id ?? "unknown";

    if (url.pathname.startsWith("/api/") && !(await isAuthorized(request, env))) {
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer", "X-Worker-Version": version },
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json(
        { ok: true, time: new Date().toISOString(), version },
        { headers: { "X-Worker-Version": version } },
      );
    }

    if (url.pathname === "/api/words" && request.method === "GET") {
      try {
        return await handleGetWords(env);
      } catch (err) {
        console.error("[GET /api/words]", err);
        return Response.json({ error: "failed to load words" }, { status: 500 });
      }
    }

    if (url.pathname === "/api/answer" && request.method === "POST") {
      try {
        return await handleAnswerPost(request, env);
      } catch (err) {
        console.error("[POST /api/answer]", err);
        return Response.json({ error: "failed to record answer" }, { status: 500 });
      }
    }

    if (url.pathname === "/api/review-fail" && request.method === "POST") {
      try {
        return await handleReviewFail(env, request);
      } catch (err) {
        console.error("[POST /api/review-fail]", err);
        return Response.json({ error: "failed to update review interval" }, { status: 500 });
      }
    }

    if (url.pathname === "/api/tabs" && request.method === "GET") {
      try {
        return await handleGetTabs(env);
      } catch (err) {
        console.error("[GET /api/tabs]", err);
        return Response.json({ error: "failed to load tabs" }, { status: 500 });
      }
    }

    if (url.pathname === "/api/words/register" && request.method === "POST") {
      try {
        return await handleWordsRegister(request, env);
      } catch (err) {
        console.error("[POST /api/words/register]", err);
        return Response.json({ error: "failed to register words" }, { status: 500 });
      }
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
