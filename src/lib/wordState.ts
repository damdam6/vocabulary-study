/**
 * PRD §5.1: 단어 상태(학습 중/복습 대기/복습 예약) 판정. §7.3에 따라 상태 판정은
 * 클라이언트 책임이므로 여기(src/lib)에 둔다. 홈 화면 현황 집계와 학습 세션 큐
 * 구성 양쪽에서 이 함수를 그대로 재사용한다.
 */

const SEOUL_TZ = "Asia/Seoul";

const seoulDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SEOUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `now`를 Asia/Seoul 기준 `YYYY-MM-DD` 문자열로 변환한다. PRD §5.4: "오늘"의 경계는 서울 자정. */
export function getSeoulToday(now: Date = new Date()): string {
  const parts = Object.fromEntries(seoulDateFormatter.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export type WordState = "learning" | "reviewDue" | "reviewScheduled";

/** getWordState가 필요로 하는 최소 필드. GET /api/words의 WordEntry와 구조적으로 호환된다. */
export interface WordProgress {
  m1: number;
  m2: number;
  nextReview: string | null;
}

/**
 * PRD §5.1 상태 판정. `today`는 호출자가 getSeoulToday()로 한 번 계산해 넘긴다 —
 * 홈 집계·세션 큐 구성 모두 여러 단어를 한 번에 분류하므로, 단어마다 today를
 * 다시 계산하지 않는다.
 */
export function getWordState(word: WordProgress, today: string): WordState {
  if (word.m1 < 3 || word.m2 < 3) {
    return "learning";
  }
  // 졸업(m1≥3 && m2≥3)했는데 nextReview가 없는 경우는 PRD에 정의되지 않은 데이터
  // 이상 상태다(정상 흐름에서는 졸업 시 F열이 항상 채워진다). 알 수 없는 미래로
  // 영원히 숨기기보다 복습 대기로 취급해 눈에 띄게 한다.
  //
  // nextReview·today는 항상 YYYY-MM-DD(zero-padded) 문자열이라는 전제로 사전식
  // 비교를 쓴다 — nextReview는 parseNextReview(worker/lib/words.ts)가, today는
  // getSeoulToday가 각각 이 형식을 보장하는 경계이므로 여기서 다시 파싱/검증하지 않는다.
  if (word.nextReview === null || word.nextReview <= today) {
    return "reviewDue";
  }
  return "reviewScheduled";
}
