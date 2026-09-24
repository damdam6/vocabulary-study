/**
 * PRD §6.2·design-prd §4.5: 학습 세션 진행 규칙 — 정오 판정에 따른 기록 effect
 * 결정과 정오 집계. 화면(StudyScreen)이 아닌 순수 모듈에 두는 이유: 네 케이스
 * (복습/학습 중 × 정오)의 API 분기가 #15의 검증 대상이라 vitest(node 환경)로
 * 고정한다 — wordState·sessionQueue와 같은 배치.
 */

import type { ContentType, WordEntry } from "./api.ts";
import type { SessionQuestion } from "./sessionQueue.ts";

/** 진행 중 큐 항목. 큐는 시작 시 확정되므로 큐 항목은 세션 문제와 같은 형태다(#116). */
export type StudyQuestion = SessionQuestion<WordEntry>;

export interface StudySessionState {
  /** 시작 시 확정돼 세션 내내 불변 — 진행도 분모(queue.length)도 따라서 불변이다(#116). */
  queue: StudyQuestion[];
  /** 현재 문제 인덱스. queue.length에 도달하면 세션 소진. */
  pos: number;
  correct: number;
  wrong: number;
}

/** 판정 직후 셸이 발사해야 할 기록 API. none = 학습 중 오답(호출 없음, §6.2). */
export type RecordEffect =
  | { kind: "answer"; question: StudyQuestion }
  | { kind: "review-fail"; question: StudyQuestion }
  | { kind: "none" };

/**
 * 느슨 채점용 정규화: NFC → 소문자화 → 공백 전면 제거(#123, #126). 공백을 1개로
 * 축약하지 않고 아예 지우는 이유(#126): 띄어쓰기가 없는 중국어·한국어 표제어는
 * 글자 사이에 공백이 하나만 끼어도(`你 好`) 시트 표제어와 영원히 불일치한다.
 * `\s`가 전각 공백(U+3000, 중문 IME)·탭도 포함하므로 IME 공백까지 함께 풀리고,
 * 앞뒤 공백도 같이 사라져 별도 트림은 불필요하다.
 */
function normalizeGenericForGrading(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

const ZH_IGNORED_PUNCTUATION = new Set(
  Array.from("，。！？；：、,.!?;:（）()【】[]《》〈〉“”‘’「」『』\"'…"),
);
const ZH_DIGIT = /^[0-9０-９]$/;

/** PRD #172 §4의 고정 목록만 제거한다. ASCII 소수점·숫자 구분 쉼표는 보존한다. */
function normalizeZhForGrading(value: string): string {
  const characters = Array.from(normalizeGenericForGrading(value));
  return characters.filter((character, index) => {
    if (!ZH_IGNORED_PUNCTUATION.has(character)) return true;
    if (
      (character === "." || character === ",")
      && ZH_DIGIT.test(characters[index - 1] ?? "")
      && ZH_DIGIT.test(characters[index + 1] ?? "")
    ) {
      return true;
    }
    return false;
  }).join("");
}

/**
 * 모드 2 채점: generic은 기존 NFC·소문자화·공백 제거를 유지하고, zh만 PRD #172
 * §4의 고정 문장부호를 추가로 제거한다. 빈 원문 또는 빈 정규화 결과는 오답이다.
 * 반환 answer는 비교용 정규화와 분리해 사용자가 제출한 원문을 그대로 보존한다.
 */
export function gradeMode2(
  input: string,
  hanzi: string,
  contentType: ContentType,
): { correct: boolean; answer: string } {
  const normalize = contentType === "zh" ? normalizeZhForGrading : normalizeGenericForGrading;
  const normalizedInput = normalize(input);
  const normalizedHanzi = normalize(hanzi);
  return {
    correct:
      input !== ""
      && hanzi !== ""
      && normalizedInput !== ""
      && normalizedHanzi !== ""
      && normalizedInput === normalizedHanzi,
    answer: input,
  };
}

/**
 * 홈이 만든 큐(sessionQueue, 시트 `문제수` 설정 상한 적용)를 그대로 세션 큐로 삼는다 —
 * 세션 중 큐가 늘어나는 경로가 없으므로 문제 수는 시작 시점에 확정된다(#116).
 */
export function startSession(
  questions: readonly SessionQuestion<WordEntry>[],
): StudySessionState {
  return {
    queue: [...questions],
    pos: 0,
    correct: 0,
    wrong: 0,
  };
}

export function currentQuestion(state: StudySessionState): StudyQuestion | null {
  return state.queue[state.pos] ?? null;
}

export function isDone(state: StudySessionState): boolean {
  return state.pos >= state.queue.length;
}

/**
 * 정오 판정을 집계·큐에 반영하고, 셸이 발사할 기록 effect를 알려준다. 진행(advance)을
 * 분리한 것은 모드2 오답이 결과 화면 동안 현재 문제에 머물러야 하기 때문(§4.5).
 * effect에 타임스탬프가 없는 것은 의도 — 시각은 발사 시점에 셸이 만든다(모듈 순수성).
 */
export function recordAnswer(
  state: StudySessionState,
  isCorrect: boolean,
): { state: StudySessionState; effect: RecordEffect } {
  const question = state.queue[state.pos];
  if (isCorrect) {
    return {
      state: { ...state, correct: state.correct + 1 },
      effect: { kind: "answer", question },
    };
  }
  if (question.isReview) {
    // 복습 오답: 간격 후퇴만(§5.3).
    return {
      state: { ...state, wrong: state.wrong + 1 },
      effect: { kind: "review-fail", question },
    };
  }
  // 학습 중 오답: API 호출 없음 — 카운트가 오르지 않아 단어가 학습 중으로 남고 다음
  // 세션에 자연히 재출제된다. 같은 세션에 다시 내지 않는 이유(#116): 방금 정답까지 본
  // 단어는 단기 기억으로 맞히게 돼 학습 효과 없이 D/E만 부풀린다.
  return {
    state: { ...state, wrong: state.wrong + 1 },
    effect: { kind: "none" },
  };
}

/** 다음 문제로 이동. 소진 여부는 isDone으로 판정한다. */
export function advance(state: StudySessionState): StudySessionState {
  return { ...state, pos: state.pos + 1 };
}

/**
 * POST /api/answer 응답의 갱신 단어를 같은 단어(tab+hanzi)의 큐 항목 스냅샷에
 * 반영한다. 셸 화면에 보이는 값은 아니지만 이후 문제가 서버 상태와 같은 데이터를
 * 보도록 정합을 지킨다. 지나간 항목까지 갱신해도 무해해서 위치를 가리지 않는다.
 */
export function applyWordUpdate(state: StudySessionState, word: WordEntry): StudySessionState {
  return {
    ...state,
    queue: state.queue.map((question) =>
      question.word.tab === word.tab && question.word.hanzi === word.hanzi
        ? { ...question, word }
        : question,
    ),
  };
}
