import { describe, expect, it } from "vitest";
import { createTtsBlobCache } from "./ttsBlobCache.ts";
import { TTS_BLOB_CACHE_MAX_BYTES, TTS_BLOB_CACHE_MAX_ENTRIES } from "./ttsTypes.ts";

const blob = (size: number) => new Blob([new Uint8Array(size)]);

describe("TtsBlobCache", () => {
  it("20개와 8MiB 경계를 넘길 때 unpinned LRU만 축출한다", () => {
    const cache = createTtsBlobCache();
    const values = Array.from({ length: TTS_BLOB_CACHE_MAX_ENTRIES + 1 }, (_, index) => blob(index + 1));
    for (let index = 0; index < TTS_BLOB_CACHE_MAX_ENTRIES; index += 1) {
      expect(cache.set(`k${index}`, values[index])).toEqual({ stored: true });
    }
    expect(cache.get("k0")).toBe(values[0]); // k1 becomes LRU
    expect(cache.set("overflow", values[20])).toEqual({ stored: true });
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("k0")).toBe(values[0]);
    expect(cache.get("overflow")).toBe(values[20]);

    const bytes = createTtsBlobCache();
    const exact = blob(TTS_BLOB_CACHE_MAX_BYTES);
    expect(bytes.set("exact", exact)).toEqual({ stored: true });
    expect(bytes.set("one-more", blob(1))).toEqual({ stored: true });
    expect(bytes.get("exact")).toBeUndefined();
    expect(bytes.set("too-large", blob(TTS_BLOB_CACHE_MAX_BYTES + 1))).toEqual({ stored: false });
    expect(bytes.get("one-more")?.size).toBe(1);
  });

  it("get과 성공 set만 MRU를 갱신하며, 실패 set은 기존 캐시를 원자적으로 보존한다", () => {
    const cache = createTtsBlobCache();
    const first = blob(4 * 1024 * 1024);
    const second = blob(4 * 1024 * 1024);
    expect(cache.set("first", first)).toEqual({ stored: true });
    expect(cache.set("second", second)).toEqual({ stored: true });
    cache.pin("first");
    cache.pin("second");
    expect(cache.set("third", blob(1))).toEqual({ stored: false });
    expect(cache.get("first")).toBe(first);
    expect(cache.get("second")).toBe(second);
    cache.unpin("first");
    expect(cache.set("third", blob(1))).toEqual({ stored: true });
    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBe(second);
  });

  it("pin은 멱등이며 pin된 항목의 다른 Blob 교체를 거절한다", () => {
    const cache = createTtsBlobCache();
    const original = blob(1);
    const replacement = blob(2);
    expect(cache.set("word", original)).toEqual({ stored: true });
    cache.pin("word");
    cache.pin("word");
    expect(cache.set("word", original)).toEqual({ stored: true });
    expect(cache.set("word", replacement)).toEqual({ stored: false });
    cache.unpin("word");
    expect(cache.set("word", replacement)).toEqual({ stored: true });
    expect(cache.get("word")).toBe(replacement);
    cache.pin("missing");
    expect(cache.set("missing", blob(1))).toEqual({ stored: true });
  });

  it("교체 크기를 중복 집계하지 않고 clear는 재사용 가능하며 dispose는 영구 종료한다", () => {
    const cache = createTtsBlobCache();
    expect(cache.set("word", blob(TTS_BLOB_CACHE_MAX_BYTES))).toEqual({ stored: true });
    expect(cache.set("word", blob(TTS_BLOB_CACHE_MAX_BYTES - 1))).toEqual({ stored: true });
    expect(cache.set("next", blob(1))).toEqual({ stored: true });
    expect(cache.get("word")?.size).toBe(TTS_BLOB_CACHE_MAX_BYTES - 1);
    cache.clear();
    expect(cache.get("word")).toBeUndefined();
    expect(cache.set("reused", blob(1))).toEqual({ stored: true });
    cache.dispose();
    expect(cache.get("reused")).toBeUndefined();
    expect(cache.set("after", blob(1))).toEqual({ stored: false });
    cache.pin("after");
    cache.unpin("after");
    cache.clear();
  });
});
