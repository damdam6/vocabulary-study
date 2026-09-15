import { TTS_BLOB_CACHE_MAX_BYTES, TTS_BLOB_CACHE_MAX_ENTRIES, type TtsBlobCache } from "./ttsTypes.ts";

interface Entry {
  blob: Blob;
  pinned: boolean;
}

/**
 * 세션 안에서만 Blob을 LRU로 보관한다. Object URL은 보관하지 않는다.
 *
 * pin은 참조 횟수가 아닌 멱등 boolean이다. pin된 key는 같은 Blob identity만 다시
 * set할 수 있고, 다른 Blob으로 교체하려면 먼저 unpin해야 한다. 저장 불가한 set은
 * 후보 축출을 계산만 할 뿐 기존 순서와 항목을 바꾸지 않는다.
 */
export function createTtsBlobCache(): TtsBlobCache {
  const entries = new Map<string, Entry>();
  let bytes = 0;
  let disposed = false;

  const touch = (key: string, entry: Entry): void => {
    entries.delete(key);
    entries.set(key, entry);
  };

  return {
    get(key) {
      if (disposed) return undefined;
      const entry = entries.get(key);
      if (!entry) return undefined;
      touch(key, entry);
      return entry.blob;
    },

    set(key, blob) {
      if (disposed || blob.size > TTS_BLOB_CACHE_MAX_BYTES) return { stored: false };
      const existing = entries.get(key);
      if (existing?.pinned && existing.blob !== blob) return { stored: false };
      if (existing?.blob === blob) {
        touch(key, existing);
        return { stored: true };
      }

      let prospectiveEntries = entries.size + (existing ? 0 : 1);
      let prospectiveBytes = bytes - (existing?.blob.size ?? 0) + blob.size;
      const evict: string[] = [];
      for (const [candidateKey, candidate] of entries) {
        if (prospectiveEntries <= TTS_BLOB_CACHE_MAX_ENTRIES && prospectiveBytes <= TTS_BLOB_CACHE_MAX_BYTES) break;
        if (candidateKey === key || candidate.pinned) continue;
        evict.push(candidateKey);
        prospectiveEntries -= 1;
        prospectiveBytes -= candidate.blob.size;
      }
      if (prospectiveEntries > TTS_BLOB_CACHE_MAX_ENTRIES || prospectiveBytes > TTS_BLOB_CACHE_MAX_BYTES) {
        return { stored: false };
      }

      for (const candidateKey of evict) entries.delete(candidateKey);
      if (existing) entries.delete(key);
      bytes = prospectiveBytes;
      entries.set(key, { blob, pinned: false });
      return { stored: true };
    },

    pin(key) {
      if (disposed) return;
      const entry = entries.get(key);
      if (entry) entry.pinned = true;
    },

    unpin(key) {
      if (disposed) return;
      const entry = entries.get(key);
      if (entry) entry.pinned = false;
    },

    clear() {
      if (disposed) return;
      entries.clear();
      bytes = 0;
    },

    dispose() {
      if (disposed) return;
      entries.clear();
      bytes = 0;
      disposed = true;
    },
  };
}
