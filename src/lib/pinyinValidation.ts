/**
 * 한자-병음 일치 판정 (단어 등록 시스템 플랜 §5-2, #49). pinyin-pro의 `multiple`
 * 옵션은 문자 하나짜리 입력에만 동작하므로(공식 문서: text 길이 1일 때만 유효),
 * 문자 단위로 후보 배열을 구해 카티전 곱 중 하나가 (공백 제거한) 입력 병음과
 * 정확히 일치하면 다음자(多音字)도 통과시킨다. 이 방식은 붙여넣은 병음 문자열을
 * 음절 단위로 분리하는 파서가 필요 없다 — 음절 경계가 모호해(예: "jing"+"ji" vs
 * "ji"+"ngji") 범용 분리가 어렵기 때문. 성조 부호 형식 검증도 별도 정규식 없이
 * 겸한다 — 후보는 항상 성조 부호를 포함하므로 무성조·숫자성조 입력은 어떤
 * 후보와도 일치하지 않아 저절로 차단된다.
 *
 * 입력 전제: hanzi는 이미 한자 유니코드 범위 검증을 통과한 문자열(registerValidation
 * 책임) — 여기서는 문자별 후보를 못 찾는 경우만 방어적으로 처리한다.
 */

import { pinyin } from "pinyin-pro";

function candidatesFor(char: string): string[] {
  const result = pinyin(char, { multiple: true, type: "array", toneType: "symbol" });
  return (Array.isArray(result) ? result : [result]).map((c) => c.toLowerCase());
}

/** hanzi의 문자별 후보 중 한 조합이 claimedPinyin(공백 무시, 대소문자 무시)과 정확히 일치하면 true. */
export function isPinyinMatch(hanzi: string, claimedPinyin: string): boolean {
  const chars = Array.from(hanzi);
  const normalized = claimedPinyin.replace(/\s+/g, "").toLowerCase();
  if (chars.length === 0 || normalized === "") return false;

  const candidateLists = chars.map(candidatesFor);
  if (candidateLists.some((list) => list.length === 0)) return false;

  // 조합 폭발 방지: acc가 normalized의 접두사가 아니면 그 가지는 즉시 버린다.
  function search(index: number, acc: string): boolean {
    if (!normalized.startsWith(acc)) return false;
    if (index === candidateLists.length) return acc === normalized;
    return candidateLists[index].some((candidate) => search(index + 1, acc + candidate));
  }

  return search(0, "");
}
