/**
 * 유의어 고르기(m3) 보기 구성. 같은 탭·같은 유의어 그룹(THES 탭 D열)의 단어만 섞어
 * 정답 포함 최대 4지(유의어가 적으면 2~3지)를 만들고, 문제 방향(뜻→원문 / 원문→뜻)은 무작위다.
 * 보기는 세션 시작 시 한 번 정해 큐에 고정한다 — 재렌더마다 바뀌지 않게.
 */
import { synonymDistractors } from "../../shared/studyModes.ts";
import type { WordEntry } from "./api.ts";
import { shuffle, type SessionQuestion } from "./sessionQueue.ts";

export const MAX_CHOICES = 4;

/** m3 문제에 보기·방향을 붙인다. words는 범위 필터 전 전체 단어(같은 그룹 단어가 보기로 쓰인다). */
export function attachSynonymChoices(
  queue: readonly SessionQuestion<WordEntry>[],
  words: readonly WordEntry[],
  rng: () => number = Math.random,
): SessionQuestion<WordEntry>[] {
  return queue.map((question) => {
    if (question.mode !== "m3") return question;
    const distractors = synonymDistractors(question.word, words);
    shuffle(distractors, rng);
    const choices = [question.word, ...distractors.slice(0, MAX_CHOICES - 1)];
    shuffle(choices, rng);
    return { ...question, choices, prompt: rng() < 0.5 ? "meaning" : "hanzi" };
  });
}
