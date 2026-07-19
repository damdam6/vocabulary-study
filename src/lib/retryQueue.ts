/**
 * 기록 유실 방지 재시도 큐 (PRD §10, design-prd §3 미전송 인디케이터, 이슈 #18).
 * POST /api/answer 실패분을 RETRY_QUEUE_STORAGE_KEY에 JSON 배열(AnswerRecord[])로
 * 적재하고, 앱 로드 시·다음 API 호출 성공 시점(App.tsx가 setApiSuccessHandler로
 * 배선)에 FIFO로 재전송한다. timestamp는 최초 판정 시각을 그대로 보존하고,
 * 재전송 실패분은 큐에 유지한다(버리지 않음).
 *
 * 큐 변경(추가·제거) 시마다 RETRY_QUEUE_CHANGED_EVENT를 발화한다 — `storage`
 * 이벤트는 다른 탭에서의 변경에만 발화하므로(같은 탭 내 변경엔 발화하지 않음),
 * 같은 탭의 홈 인디케이터가 즉시 반영되려면 이 커스텀 이벤트가 필요하다.
 */

import { postAnswer, type AnswerRecord } from "./api.ts";

export const RETRY_QUEUE_STORAGE_KEY = "vocab-study:retry-queue";

export const RETRY_QUEUE_CHANGED_EVENT = "vocab-study:retry-queue-changed";

/** 저장된 큐를 읽는다. 없거나 파손된 JSON이면 빈 큐로 취급한다. */
function readQueue(): AnswerRecord[] {
  const raw = localStorage.getItem(RETRY_QUEUE_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: AnswerRecord[]): void {
  localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event(RETRY_QUEUE_CHANGED_EVENT));
}

export function getRetryQueueLength(): number {
  return readQueue().length;
}

/** 전송 실패한 기록을 큐 끝에 적재한다. 저장 실패(쿼터 등)는 삼킨다 — 학습 진행(§6.2)이 우선. */
export function enqueueAnswer(record: AnswerRecord): void {
  try {
    saveQueue([...readQueue(), record]);
  } catch {
    // localStorage 저장 실패 시 이 기록은 유실되지만 학습 진행은 막지 않는다
  }
}

// flush 중의 postAnswer 성공이 API 성공 핸들러를 통해 flush를 재호출하므로,
// 재진입을 no-op으로 만들지 않으면 재귀한다.
let flushing = false;

/**
 * 큐를 FIFO로 재전송한다. 항목은 전송 성공 시에만 제거하고, 첫 실패에서 중단해
 * 잔여를 유지한다(네트워크가 죽어 있으면 나머지도 실패할 것이므로). 전송 중
 * 새로 적재된 항목은 뒤에 append되므로(제거는 재읽기 후 맨 앞) 유실되지 않는다.
 */
export async function flushRetryQueue(): Promise<void> {
  if (flushing) {
    return;
  }
  flushing = true;
  try {
    let queue = readQueue();
    while (queue.length > 0) {
      // 갱신 단어 응답은 세션 문맥이 없으므로 무시한다
      await postAnswer(queue[0]);
      // await 중 새로 적재된 항목이 반영되도록 재읽은 뒤 맨 앞만 제거한다.
      // 방금 저장한 값이 곧 최신 큐이므로 다음 반복은 재읽기 없이 재사용한다.
      const remaining = readQueue().slice(1);
      saveQueue(remaining);
      queue = remaining;
    }
  } catch {
    // 첫 실패에서 중단 — 실패 항목과 잔여는 큐에 유지. postAnswer 실패뿐 아니라
    // 전송 성공 직후 saveQueue 실패(쿼터 등)도 여기로 와 즉시 중단된다 — 이 경우
    // 제거되지 못한 항목이 다음 플러시에서 중복 제출될 수 있으나, 유실 방지를
    // 우선하는 PRD §10 트레이드오프로 수용한다(응답 유실 중복과 같은 성격).
  } finally {
    flushing = false;
  }
}
