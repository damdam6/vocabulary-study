import { TTS_MODELS, isTtsModel } from '../../shared/ttsModels.ts';
import { MODEL_SELECTION_KEY, readModelSelection, selectionBucket } from '../lib/tts/modelSelection.ts';
import type { Profile } from '../lib/profiles.ts';
import type { TtsWorkerEnv } from '../lib/tts/types.ts';

export async function handleTtsModels(request: Request, env: TtsWorkerEnv, profile: Profile): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (profile.contentType !== 'zh') return reply({ error: '중국어 프로필에서만 변경할 수 있습니다.' }, 403);
  if (request.method !== 'GET' && request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  let model;
  if (request.method === 'POST') {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply({ error: 'JSON 요청이 필요합니다.' }, 415);
    try {
      // The setting is a small identifier, never an arbitrary provider configuration.
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: '모델을 선택해 주세요.' }, 400);
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) { await reader.cancel(); return reply({ error: '요청이 너무 큽니다.' }, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      if (!isTtsModel(body?.model)) return reply({ error: '등록된 음성 모델 하나를 선택해 주세요.' }, 400);
      model = body.model;
    } catch { return reply({ error: '올바른 JSON 요청이 필요합니다.' }, 400); }
  }
  try {
    if (model !== undefined) await selectionBucket(env).put(MODEL_SELECTION_KEY, JSON.stringify({ model }), { httpMetadata: { contentType: 'application/json' } });
    else model = await readModelSelection(env);
    return reply({ models: TTS_MODELS, model });
  } catch { return reply({ error: '음성 모델 설정을 불러오거나 저장하지 못했습니다.' }, 503); }
}
