/**
 * 기록 유실 방지 재시도 큐(기능 PRD §7.2, design-prd §3 미전송 인디케이터) 계약.
 * 큐 자체(적재·재전송, 이슈 #18)는 아직 구현되지 않았다 — 홈 화면(#13)이 "읽는
 * 쪽" 계약을 먼저 정의해 둔다. #18은 반드시:
 *   1. 이 파일의 RETRY_QUEUE_STORAGE_KEY에 JSON 배열로 큐를 저장하고
 *   2. 큐를 추가·제거할 때마다 `window.dispatchEvent(new Event(RETRY_QUEUE_CHANGED_EVENT))`를 호출해야 한다.
 * `storage` 이벤트는 다른 탭에서의 변경에만 발화하므로(같은 탭 내 변경엔 발화하지 않음),
 * 같은 탭에서 즉시 반영되려면 이 커스텀 이벤트가 필요하다.
 */

export const RETRY_QUEUE_STORAGE_KEY = "vocab-study:retry-queue";

export const RETRY_QUEUE_CHANGED_EVENT = "vocab-study:retry-queue-changed";

export function getRetryQueueLength(): number {
  const raw = localStorage.getItem(RETRY_QUEUE_STORAGE_KEY);
  if (!raw) {
    return 0;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
