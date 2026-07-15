import { handleGetWords } from "./routes/words.ts";
import { isAuthorized } from "./lib/auth.ts";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") && !isAuthorized(request, env)) {
      return new Response(null, { status: 401 });
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, time: new Date().toISOString() });
    }

    if (url.pathname === "/api/words" && request.method === "GET") {
      try {
        return await handleGetWords(env);
      } catch (err) {
        console.error("[GET /api/words]", err);
        return Response.json({ error: "failed to load words" }, { status: 500 });
      }
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
