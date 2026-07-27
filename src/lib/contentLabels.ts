/**
 * design-prd §4.6: zh/generic 콘텐츠 타입별 렌더링 분기값. 컴포넌트 테스트 환경이
 * 없어(hanziSize.ts와 같은 이유) 분기 로직을 lib로 뽑아 vitest로 고정한다.
 * "미적용"(이슈 #80 완료 조건)은 대체 문자열이 아니라 undefined로 표현한다 —
 * React가 undefined 속성을 그대로 생략한다.
 */
import type { ContentType } from "./api.ts";
import type { QuizMode } from "./sessionQueue.ts";

export function modeChipLabel(contentType: ContentType, mode: QuizMode): string {
  if (contentType === "zh") return mode === "m1" ? "한자 → 뜻" : "뜻 → 한자";
  return mode === "m1" ? "단어 → 뜻" : "뜻 → 단어";
}

export function headwordLang(contentType: ContentType): string | undefined {
  return contentType === "zh" ? "zh-Hans" : undefined;
}

export function mode2Hint(contentType: ContentType): string {
  return contentType === "zh" ? "이 뜻의 한자를 입력하세요" : "이 뜻에 해당하는 단어를 입력하세요";
}

export function mode2Placeholder(contentType: ContentType): string | undefined {
  return contentType === "zh" ? "汉字" : undefined;
}
