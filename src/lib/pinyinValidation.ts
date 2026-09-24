/** #174 형식 검사 뒤 사용하는 보조 검토. 후보 일치는 문맥상 발음 보증이 아니다. */
import { pinyin } from "pinyin-pro";
import { MAX_HANZI_CODE_POINTS, MAX_PINYIN_CODE_POINTS, REGISTRATION_PUNCTUATION } from "../../shared/registration";

export type PinyinReview = "match" | "mismatch" | "unverified";
export const PINYIN_REVIEW_WARNING = "병음을 자동 확인하지 못했어요. 원문과 함께 확인하세요.";
export const MAX_PINYIN_TRANSITIONS = 20_000;
const separators = new Set(` \u3000${REGISTRATION_PUNCTUATION}`);
const syllable = /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+$/u;

/** 원문/병음 부호는 비교용 복사본에서만 제거한다. 숫자/약어는 추측하지 않는다. */
export function reviewPinyin(hanzi: string, claimedPinyin: string): PinyinReview {
  const source = Array.from(hanzi.normalize("NFC"));
  const claim = Array.from(claimedPinyin.normalize("NFC").toLowerCase());
  if (source.length > MAX_HANZI_CODE_POINTS || claim.length > MAX_PINYIN_CODE_POINTS) return "unverified";
  const chars = source.filter((c) => !separators.has(c));
  const normalized = claim.filter((c) => !separators.has(c)).join("");
  if (!chars.length || !normalized || chars.some((c) => !/^[一-鿿]$/u.test(c))) return "unverified";

  const cache = new Map<string, string[]>();
  let ambiguous = chars.some((c) => c === "一" || c === "不");
  let transitions = 0;
  let previousThirdTone = false;
  // 문자 index마다 도달 가능한 병음 offset만 보관한다. 동일 상태는 한 번만 탐색한다.
  let offsets = new Set([0]);
  for (const char of chars) {
    let candidates = cache.get(char);
    if (!candidates) {
      const result = pinyin(char, { multiple: true, type: "array", toneType: "symbol" });
      candidates = [...new Set((Array.isArray(result) ? result : [result]).map((c) => c.normalize("NFC").toLowerCase()))];
      if (!candidates.length || candidates.some((c) => !syllable.test(c))) return "unverified";
      cache.set(char, candidates);
    }
    if (candidates.length > 1) ambiguous = true;
    // 3성 연속은 사전형과 실제 변조형 어느 쪽도 문맥 없이 확정하지 않는다.
    const thirdTone = candidates.some((candidate) => /[ǎěǐǒǔǚ]/u.test(candidate));
    if (previousThirdTone && thirdTone) ambiguous = true;
    previousThirdTone = thirdTone;
    const next = new Set<number>();
    for (const offset of offsets) {
      for (const candidate of candidates) {
        if (++transitions > MAX_PINYIN_TRANSITIONS) return "unverified";
        if (normalized.startsWith(candidate, offset)) next.add(offset + candidate.length);
      }
    }
    offsets = next;
    // 계속 문자를 확인해 뒤쪽 다음자의 불확실성도 반영한다.
  }
  if (ambiguous) return "unverified";
  return offsets.has(normalized.length) ? "match" : "mismatch";
}
