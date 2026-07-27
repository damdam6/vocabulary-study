/**
 * 기록 유실 방지 재시도 큐 (PRD §10, design-prd §3 미전송 인디케이터, 이슈 #18·#43·#79).
 * POST /api/answer, POST /api/review-fail 실패분을 종류 태그가 붙은 엔트리로
 * RETRY_QUEUE_STORAGE_KEY에 JSON 배열(RetryQueueEntry[])로 적재하고, 앱 로드
 * 시·다음 API 호출 성공 시점(App.tsx가 setApiSuccessHandler로 배선)에 FIFO로
 * 재전송한다. answer/review-fail이 같은 배열에 순서대로 섞여 들어가므로, 같은
 * 단어의 기록이 섞여 있어도 적재 순서 그대로 재전송된다. timestamp(answer)는
 * 최초 판정 시각을 그대로 보존하고, 재전송 실패분은 큐에 유지한다(버리지 않음).
 *
 * 큐 변경(추가·제거) 시마다 RETRY_QUEUE_CHANGED_EVENT를 발화한다 — `storage`
 * 이벤트는 다른 탭에서의 변경에만 발화하므로(같은 탭 내 변경엔 발화하지 않음),
 * 같은 탭의 홈 인디케이터가 즉시 반영되려면 이 커스텀 이벤트가 필요하다.
 *
 * 프로필 태깅(PRD-general §8, #79): 엔트리마다 적재 시점의 활성 프로필 id를
 * 싣는다. flush·길이 조회는 현재 활성 프로필의 항목만 대상으로 하고, 다른
 * 프로필의 항목은 건드리지 않고 보존한다 — 그 프로필로 재로그인하면 그때 전송된다.
 */

import { ApiError, getStoredProfile, postAnswer, postReviewFail, type AnswerRecord, type ReviewFailRecord } from "./api.ts";

export const RETRY_QUEUE_STORAGE_KEY = "vocab-study:retry-queue";

export const RETRY_QUEUE_CHANGED_EVENT = "vocab-study:retry-queue-changed";

export type RetryQueueEntry =
  | { kind: "answer"; record: AnswerRecord; profileId?: string }
  | { kind: "review-fail"; record: ReviewFailRecord; profileId?: string };

/**
 * 저장된 큐를 읽는다. 없거나 파손된 JSON이면 빈 큐로 취급한다. #43 이전(#18/PR #40)
 * 배포분은 태그 없는 평면 AnswerRecord[]로 저장돼 있을 수 있어, kind 필드가 없는
 * 항목은 레거시 answer 레코드로 승격시킨다 — 그대로 두면 파싱 형태가 달라 재전송
 * 대상에서 조용히 빠지고 유실될 수 있다(#18의 유실 방지 취지 위반). 같은 이유로
 * profileId가 없는(단일 프로필 시절 적재분) 항목은 currentProfileId 소속으로
 * 승격한다(#79) — 승격은 큐가 실제로 변경(saveQueue)될 때 영속화된다.
 */
function readQueue(currentProfileId: string | undefined): RetryQueueEntry[] {
  const raw = localStorage.getItem(RETRY_QUEUE_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => {
      const entry: RetryQueueEntry =
        item && typeof item === "object" && "kind" in item ? item : { kind: "answer", record: item };
      return entry.profileId === undefined ? { ...entry, profileId: currentProfileId } : entry;
    });
  } catch {
    return [];
  }
}

function saveQueue(queue: RetryQueueEntry[]): void {
  localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event(RETRY_QUEUE_CHANGED_EVENT));
}

/** 현재 활성 프로필 소속(승격된 레거시 항목 포함)의 큐 길이 — 홈 미전송 인디케이터(#79)가 다른 프로필 항목까지 세지 않도록 한다. */
export function getRetryQueueLength(): number {
  const profileId = getStoredProfile()?.id;
  return readQueue(profileId).filter((entry) => entry.profileId === profileId).length;
}

function enqueue(entry: RetryQueueEntry): void {
  try {
    const profileId = getStoredProfile()?.id;
    saveQueue([...readQueue(profileId), { ...entry, profileId }]);
  } catch {
    // localStorage 저장 실패 시 이 기록은 유실되지만 학습 진행은 막지 않는다
  }
}

/** 전송 실패한 정오 기록을 큐 끝에 적재한다. 저장 실패(쿼터 등)는 삼킨다 — 학습 진행(§6.2)이 우선. */
export function enqueueAnswer(record: AnswerRecord): void {
  enqueue({ kind: "answer", record });
}

/** 전송 실패한 복습 오답 간격 후퇴를 큐 끝에 적재한다(#43). 저장 실패 처리는 enqueueAnswer와 동일. */
export function enqueueReviewFail(record: ReviewFailRecord): void {
  enqueue({ kind: "review-fail", record });
}

// flush 중의 postAnswer 성공이 API 성공 핸들러를 통해 flush를 재호출하므로,
// 재진입을 no-op으로 만들지 않으면 재귀한다.
let flushing = false;

/**
 * 큐를 FIFO로 재전송한다(#79: 현재 활성 프로필의 항목만 대상). 엔트리 kind에
 * 따라 postAnswer/postReviewFail로 분기 호출한다. 다른 프로필 소속 항목은
 * 건드리지 않고 건너뛴다(보존) — 그 프로필로 재로그인하면 그때 전송된다.
 *
 * 실패 분류: 4xx(ApiError, 비활성 모드 400·단어 삭제 404 등 — 재시도해도 영원히
 * 같은 결과)는 그 항목만 폐기하고 다음 항목을 계속 전송한다. 네트워크 예외·5xx는
 * 일시 실패로 보고 그 항목과 잔여를 큐에 유지한 채 즉시 중단한다(네트워크가 죽어
 * 있으면 나머지도 실패할 것이므로). 전송 중 새로 적재된 항목은 뒤에 append되므로
 * (제거는 매번 재읽기 후 같은 인덱스) 유실되지 않는다.
 */
export async function flushRetryQueue(): Promise<void> {
  if (flushing) {
    return;
  }
  flushing = true;
  try {
    const profileId = getStoredProfile()?.id;
    let queue = readQueue(profileId);
    let i = 0;
    while (i < queue.length) {
      const entry = queue[i];
      if (entry.profileId !== profileId) {
        // 다른 프로필 소속 — 보존하고 다음 인덱스로
        i++;
        continue;
      }
      try {
        // 갱신 단어 응답은 세션 문맥이 없으므로 무시한다
        if (entry.kind === "answer") {
          await postAnswer(entry.record);
        } else {
          await postReviewFail(entry.record.tab, entry.record.hanzi);
        }
      } catch (err) {
        if (!(err instanceof ApiError) || err.status < 400 || err.status >= 500) {
          // 네트워크 예외·5xx — 중단, 이 항목과 잔여는 큐에 유지
          return;
        }
        // 4xx 영구 실패 — 이 항목은 폐기하고 다음 항목으로 계속 (제거 로직은 성공 시와 동일)
      }
      // 전송 성공 또는 4xx 폐기 — 해당 항목 제거. await 중 새로 적재된 항목이
      // 반영되도록 재읽은 뒤 같은 인덱스만 제거한다(enqueue는 항상 끝에
      // append하므로 앞쪽 인덱스는 안정적이다).
      const remaining = readQueue(profileId);
      remaining.splice(i, 1);
      saveQueue(remaining);
      queue = remaining;
    }
  } catch {
    // saveQueue 실패(쿼터 등) 등 예기치 못한 실패 — 중단하고 잔여는 큐에 유지.
    // 이 경우 방금 전송된(또는 폐기 판정된) 항목이 제거되지 못해 다음 플러시에서
    // 중복 제출될 수 있으나, 유실 방지를 우선하는 PRD §10 트레이드오프로 수용한다.
  } finally {
    flushing = false;
  }
}
