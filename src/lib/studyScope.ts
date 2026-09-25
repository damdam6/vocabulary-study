/**
 * 학습 범위 모델(PRD-tab-scoped-study.md §3·§4.3, #188). 홈이 `/api/words` 응답을
 * 이 모듈의 함수로 걸러 computeHomeStats·buildSessionQueue에 넘기면, 두 함수의
 * 시그니처와 산식을 바꾸지 않고도 "전체" 또는 "고른 탭 n개"로 세션 범위를 좁힐 수
 * 있다. UI(#189)는 이 이슈 범위 밖 — 여기서는 타입·순수 로직·저장소 접근만 다룬다.
 */

export type StudyScope = { kind: "all" } | { kind: "tabs"; tabs: string[] };

export const STUDY_SCOPE_STORAGE_KEY = "vocab-study:study-scope";

/**
 * localStorage에 프로필별로 저장되는 실제 레코드. `tabs`는 `kind`와 무관하게 항상
 * "마지막 탭 선택"을 담는다 — `kind === "all"`로 저장해도 지우지 않는다. 그래야
 * 세그먼트를 전체로 바꿨다가 다시 탭 선택으로 돌아왔을 때 이전 칩 선택이
 * 복원된다(§4.3).
 */
interface StoredScope {
  kind: "all" | "tabs";
  tabs: string[];
}

type StudyScopeStore = Record<string, StoredScope>;

/**
 * `words[].tab`을 처음 등장한 순서로 중복 제거해 탭 목록을 만든다(§3). 서버가 시트
 * 탭 순서대로 이어 붙여 반환하므로 이 순서가 곧 시트 탭 순서다. `GET /api/tabs`는
 * 호출하지 않는다.
 */
export function deriveTabs(words: readonly { tab: string }[]): string[] {
  const seen = new Set<string>();
  const tabs: string[] = [];
  for (const word of words) {
    if (!seen.has(word.tab)) {
      seen.add(word.tab);
      tabs.push(word.tab);
    }
  }
  return tabs;
}

/**
 * 범위를 단어 목록에 적용한다(§3). `"all"`이면 전체를 복사해 반환하고, `"tabs"`면
 * 탭 이름이 정확히 일치하는(트림·대소문자 무시 없음) 단어만 남긴다. `tabs`가 빈
 * 배열이면 결과도 빈 배열이다 — "선택 중" 상태와 "전체"는 다른 상태로 유지된다.
 * `computeHomeStats`·`buildSessionQueue` 호출 이전에만 쓰이므로 그 두 함수의
 * 시그니처는 손대지 않는다(#128 불변식은 이 필터 함수를 양쪽이 공유하는 것으로
 * 지킨다).
 */
export function filterWordsByScope<T extends { tab: string }>(words: readonly T[], scope: StudyScope): T[] {
  if (scope.kind === "all") {
    return [...words];
  }
  const tabs = new Set(scope.tabs);
  return words.filter((word) => tabs.has(word.tab));
}

function isValidStoredScope(value: unknown): value is StoredScope {
  if (value === null || typeof value !== "object") return false;
  const kind = (value as Record<string, unknown>).kind;
  const tabs = (value as Record<string, unknown>).tabs;
  if (kind !== "all" && kind !== "tabs") return false;
  return Array.isArray(tabs) && tabs.every((tab) => typeof tab === "string");
}

/** 손상됐거나(JSON 파싱 실패) 형태가 다르면(배열 등) 빈 맵으로 취급한다 — 프로필별 엔트리 검증은 호출부가 개별로 한다. */
function readStore(): StudyScopeStore {
  const raw = localStorage.getItem(STUDY_SCOPE_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as StudyScopeStore;
  } catch {
    return {};
  }
}

function writeStore(store: StudyScopeStore): void {
  localStorage.setItem(STUDY_SCOPE_STORAGE_KEY, JSON.stringify(store));
}

/**
 * 범위를 프로필 id별로 저장한다(§4.3). 선택 0개(`kind === "tabs"`, `tabs.length === 0`)
 * 상태는 저장하지 않는다 — "선택 중"일 뿐이라, 0개인 채로 홈을 떠나도 마지막으로
 * 비어 있지 않았던 선택이 그대로 남는다. `kind === "all"`로 저장할 때도 기존 탭
 * 선택은 지우지 않고 그대로 보존한다.
 */
export function saveStudyScope(profileId: string, scope: StudyScope): void {
  if (scope.kind === "tabs" && scope.tabs.length === 0) {
    return;
  }
  const store = readStore();
  const previous = store[profileId];
  const preservedTabs = isValidStoredScope(previous) ? previous.tabs : [];
  store[profileId] = {
    kind: scope.kind,
    tabs: scope.kind === "tabs" ? scope.tabs : preservedTabs,
  };
  writeStore(store);
}

/**
 * 저장값을 읽어 `availableTabs`에 없는 탭(탭 이름 변경·삭제, 단어 0개)을 조용히
 * 걸러내고, 정리 결과가 원래 저장값과 다르면(다른 프로필 엔트리는 건드리지 않고)
 * 저장값도 갱신한다. `restoreStudyScope`·`getLastTabSelection`이 공유하는 내부
 * 헬퍼 — 정리 로직과 쓰기 부수효과를 한 곳에만 둔다.
 */
function readAndPruneStoredScope(
  profileId: string,
  availableTabs: readonly string[],
): { resolvedKind: "all" | "tabs"; prunedTabs: string[] } {
  const store = readStore();
  const stored = store[profileId];
  if (!isValidStoredScope(stored)) {
    return { resolvedKind: "all", prunedTabs: [] };
  }

  const available = new Set(availableTabs);
  const prunedTabs = stored.tabs.filter((tab) => available.has(tab));
  const resolvedKind: "all" | "tabs" = stored.kind === "tabs" && prunedTabs.length === 0 ? "all" : stored.kind;

  if (prunedTabs.length !== stored.tabs.length || resolvedKind !== stored.kind) {
    store[profileId] = { kind: resolvedKind, tabs: prunedTabs };
    writeStore(store);
  }

  return { resolvedKind, prunedTabs };
}

/**
 * 저장된 범위를 복원한다(§4.3). 저장값이 없거나 손상됐으면 전체로 복원한다. 정리
 * 후 남은 탭이 없으면 전체로 되돌린다 — `kind: "tabs"`에 빈 `tabs`가 저장된 채로
 * 남지 않는다. `kind === "all"`일 때 보존된 마지막 탭 선택은 이 반환값에 실리지
 * 않는다 — `StudyScope`의 `all` variant는 tabs를 담을 수 없어서다. 그 값이
 * 필요하면 `getLastTabSelection`을 쓴다.
 */
export function restoreStudyScope(profileId: string, availableTabs: readonly string[]): StudyScope {
  const { resolvedKind, prunedTabs } = readAndPruneStoredScope(profileId, availableTabs);
  return resolvedKind === "tabs" ? { kind: "tabs", tabs: prunedTabs } : { kind: "all" };
}

/**
 * 프로필의 "마지막 탭 선택"을 활성 범위의 kind와 무관하게 반환한다(§4.1 "탭 선택으로
 * 처음 바꿀 때의 초기 선택: 마지막 탭 선택이 있으면 그 탭들"). `saveStudyScope`는
 * `kind === "all"`로 저장해도 이전 탭 선택을 지우지 않으므로(§4.3), 활성 범위가
 * 전체여도 이 함수로 그 선택을 읽을 수 있다. `availableTabs`에 없는 탭은 걸러내고,
 * 저장값이 없거나 손상됐거나 전부 걸러졌으면 빈 배열이다.
 */
export function getLastTabSelection(profileId: string, availableTabs: readonly string[]): string[] {
  return readAndPruneStoredScope(profileId, availableTabs).prunedTabs;
}
