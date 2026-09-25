// design-prd §3 홈 화면. 세션 큐 구성은 홈 책임(기능 PRD §6.1) — 시작 클릭 시
// 이미 조회해 둔 단어로 큐를 만들어 onStart(queue)로 올린다(#15 셸 계약).
// 현황 집계(sessionCount)와 큐가 같은 조회 결과를 쓰므로 수치가 어긋나지 않는다.
// 학습 범위(#189)도 이 성질을 지킨다 — 범위로 거른 배열(scopedWords) 하나를 현황 카드·
// 세션 수·큐가 함께 쓴다.
import { useEffect, useMemo, useState } from "react";
import HomeUtilBar from "../components/HomeUtilBar.tsx";
import StudyScopePicker, { type StudyScopeKind } from "../components/StudyScopePicker.tsx";
import { getStoredProfile, saveProfile, type PublicProfile, type WordEntry } from "../lib/api.ts";
import { formatHomeDate } from "../lib/date.ts";
import { computeHomeStats, type HomeStats } from "../lib/homeStats.ts";
import { RETRY_QUEUE_CHANGED_EVENT, RETRY_QUEUE_STORAGE_KEY, getRetryQueueLength } from "../lib/retryQueue.ts";
import { buildSessionQueue, SESSION_CAP, type SessionQuestion } from "../lib/sessionQueue.ts";
import {
  deriveTabs,
  filterWordsByScope,
  getLastTabSelection,
  pickDefaultTabSelection,
  restoreStudyScope,
  saveStudyScope,
  type StudyScope,
} from "../lib/studyScope.ts";
import { getSeoulToday } from "../lib/wordState.ts";
import { fetchWords } from "../lib/wordsApi.ts";
import type { TtsCapability } from "../lib/ttsTypes.ts";

/** Home의 단일 words 응답에서 확정해 App이 Study 수명 동안 고정하는 값이다. */
export interface StudySessionContext {
  profile: PublicProfile
  tts: TtsCapability
}

interface HomeScreenProps {
  /** 큐는 시트 문제 수 설정 상한까지 잘라서 올린다 — 세션 문제 수는 이 큐로 확정된다(#116). */
  onStart: (queue: SessionQuestion<WordEntry>[], context: StudySessionContext) => void
  onNavigateRegister: () => void
  onSwitchProfile: () => void
}

type Status = "loading" | "error" | "ready";

const ALL_SCOPE: StudyScope = { kind: "all" };

/**
 * 세션 수 줄 앞에 붙는 범위 표기(PRD-tab-scoped-study §4.2) — 첫 이름은 시트 순서 기준.
 * 이름만 말줄임하도록 이름과 나머지를 나눠 돌려준다. 전체 범위면 null(현행 문구 그대로).
 */
function describeScope(scope: StudyScope, tabs: readonly string[]): { name: string; rest: string } | null {
  if (scope.kind === "all") return null;
  const selected = new Set(scope.tabs);
  const ordered = tabs.filter((tab) => selected.has(tab));
  if (ordered.length === 0) return null;
  return { name: ordered[0], rest: ordered.length > 1 ? ` 외 ${ordered.length - 1}개 탭` : "" };
}

function HomeScreen({ onStart, onNavigateRegister, onSwitchProfile }: HomeScreenProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [words, setWords] = useState<WordEntry[]>([]);
  // 현황 집계의 기준일은 조회 시점으로 고정한다 — 범위를 바꿀 때마다 다시 계산해도 같은 날짜를 쓴다.
  const [today, setToday] = useState(() => getSeoulToday());
  const [scope, setScope] = useState<StudyScope>(ALL_SCOPE);
  const [profile, setProfile] = useState<PublicProfile | null>(() => getStoredProfile());
  const [errorMessage, setErrorMessage] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [retryQueueLength, setRetryQueueLength] = useState(0);
  // 시트별 세션 문제 수(세션 설정 플랜 §3.2) — words 응답 동봉값, 미동봉 시 fetchWords가 SESSION_CAP으로 폴백.
  const [sessionLimit, setSessionLimit] = useState(SESSION_CAP);
  const [tts, setTts] = useState<TtsCapability>({ enabled: false });

  // App.tsx가 홈 화면을 조건부로만 렌더링하므로, 홈을 벗어났다 돌아올 때마다
  // 이 컴포넌트가 새로 마운트되어 design-prd §3의 "홈 진입 시마다 재조회"를 만족한다.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setStatus("loading");
    fetchWords(controller.signal)
      .then(({ profile: fetchedProfile, words: fetched, settings, tts: fetchedTts }) => {
        if (cancelled) return;
        setWords(fetched);
        setProfile(fetchedProfile);
        saveProfile(fetchedProfile);
        setSessionLimit(settings.sessionLimit);
        setTts(fetchedTts);
        setToday(getSeoulToday());
        // 홈 진입마다 새 응답으로 저장된 범위를 다시 검증한다 — 사라진 탭 정리·저장값 갱신은
        // restoreStudyScope가 맡고, 남은 탭이 없으면 전체로 돌아온다(§4.3).
        setScope(restoreStudyScope(fetchedProfile.id, deriveTabs(fetched)));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "단어를 불러오지 못했습니다");
        setStatus("error");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [retryKey]);

  // storage: 다른 탭에서의 재시도 큐 변경. RETRY_QUEUE_CHANGED_EVENT: 같은 탭에서의 변경(#18 계약).
  useEffect(() => {
    const updateRetryQueueLength = () => setRetryQueueLength(getRetryQueueLength());
    // storage 이벤트는 탭 내 모든 localStorage 변경에 발화하므로, 재시도 큐 키(또는
    // localStorage.clear()의 key:null)가 아니면 무시해 불필요한 재조회를 막는다.
    const handleStorage = (e: StorageEvent) => {
      if (e.key === RETRY_QUEUE_STORAGE_KEY || e.key === null) {
        updateRetryQueueLength();
      }
    };
    updateRetryQueueLength();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(RETRY_QUEUE_CHANGED_EVENT, updateRetryQueueLength);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(RETRY_QUEUE_CHANGED_EVENT, updateRetryQueueLength);
    };
  }, []);

  const tabs = useMemo(() => deriveTabs(words), [words]);
  // 탭이 1개뿐이면 전체와 결과가 같아 선택 UI를 숨긴다. 로딩·에러에서도 숨긴다(§4.1).
  const scopePickerVisible = status === "ready" && tabs.length > 1;
  // 선택 UI가 숨으면 전체로 동작한다 — 저장값은 덮어쓰지 않아 탭이 다시 늘면 이전 선택이 돌아온다.
  const activeScope = scopePickerVisible ? scope : ALL_SCOPE;
  // 필터는 여기 한 번만 호출한다: 현황 카드·세션 수(stats)와 시작 큐(handleStart)가 이 배열을 공유해야
  // 표시 n과 실제 큐 길이가 같다(#128 불변식).
  const scopedWords = useMemo(() => filterWordsByScope(words, activeScope), [words, activeScope]);
  const stats: HomeStats | null = useMemo(
    () => (profile === null ? null : computeHomeStats(scopedWords, today, profile.modes, sessionLimit)),
    [scopedWords, today, profile, sessionLimit],
  );
  // 칩 라벨의 n — 그 탭만 골랐을 때의 세션 수. 같은 필터·같은 산식이라 그 탭 하나만 켰을 때의 세션 수 줄과 같다.
  const tabCounts = useMemo(() => {
    if (!scopePickerVisible || profile === null) return [];
    return tabs.map((tab) => ({
      tab,
      count: computeHomeStats(
        filterWordsByScope(words, { kind: "tabs", tabs: [tab] }),
        today,
        profile.modes,
        sessionLimit,
      ).sessionCount,
    }));
  }, [scopePickerVisible, tabs, words, today, profile, sessionLimit]);

  const noTabSelected = activeScope.kind === "tabs" && activeScope.tabs.length === 0;
  const canStart = status === "ready" && !noTabSelected && (stats?.sessionCount ?? 0) > 0;
  const scopeLabel = describeScope(activeScope, tabs);

  // 저장은 사용자 조작 경로에서만 한다 — 선택 0개는 saveStudyScope가 알아서 건너뛴다(§4.3).
  const updateScope = (next: StudyScope) => {
    setScope(next);
    if (profile !== null) saveStudyScope(profile.id, next);
  };

  const handleKindChange = (kind: StudyScopeKind) => {
    if (kind === scope.kind || profile === null) return;
    if (kind === "all") {
      updateScope(ALL_SCOPE);
      return;
    }
    // 마지막 탭 선택이 있으면 그 탭들(전체로 갔다 돌아와도 이전 칩 선택 복원), 없으면 문제 수가 가장 많은 탭 1개(§4.1).
    const last = getLastTabSelection(profile.id, tabs);
    updateScope({ kind: "tabs", tabs: last.length > 0 ? last : pickDefaultTabSelection(tabCounts) });
  };

  const handleSelectedChange = (selected: string[]) => {
    updateScope({ kind: "tabs", tabs: selected });
  };

  const handleStart = () => {
    // canStart(sessionCount>0)와 같은 단어 집합(scopedWords)·같은 산식(같은 sessionLimit)이므로 빈 큐가 나올 수 없다
    if (profile === null) return;
    onStart(buildSessionQueue(scopedWords, getSeoulToday(), profile.modes, undefined, sessionLimit), { profile, tts });
  };

  const startLabel =
    status === "loading" ? "불러오는 중…" : noTabSelected ? "탭을 선택하세요" : canStart ? "학습 시작" : "오늘 할 것 없음";

  return (
    <div className="home-screen">
      {/* 유틸 바(#105)는 헤더 우측 고정 — 하단 저강조 링크 2개를 대체한다. 등록 진입의
          "오늘 학습 상태(로딩/에러/완료)와 무관하게 항상 노출" 성질을 유틸 바가 승계하므로
          이 행은 status와 무관하게 렌더된다. */}
      <div className="home-header">
        <div className="home-header-text">
          <p className="home-date">{formatHomeDate()}</p>
          <h1 className="home-title">오늘의 학습</h1>
          {profile && <p className="home-profile-name">{profile.name}</p>}
        </div>
        <HomeUtilBar onNavigateRegister={onNavigateRegister} onSwitchProfile={onSwitchProfile} />
      </div>

      {status === "loading" && (
        <div className="status-cards" aria-hidden="true">
          <div className="status-card skeleton" />
          <div className="status-card skeleton" />
          <div className="status-card skeleton" />
        </div>
      )}

      {status === "error" && (
        <div className="error-card">
          <p className="error-card-title">단어를 불러오지 못했습니다</p>
          <p className="error-card-reason">{errorMessage}</p>
          <button type="button" className="retry-fetch-button" onClick={() => setRetryKey((k) => k + 1)}>
            다시 시도
          </button>
        </div>
      )}

      {status === "ready" && stats && (
        <div className="status-cards">
          <div className="status-card">
            <span className="status-card-value status-card-review-due">{stats.reviewDue}</span>
            <span className="status-card-label">복습 대기</span>
          </div>
          <div className="status-card">
            <span className="status-card-value status-card-learning">{stats.learning}</span>
            <span className="status-card-label">학습 중</span>
          </div>
          <div className="status-card">
            <span className="status-card-value status-card-graduated">{stats.graduated}</span>
            <span className="status-card-label">졸업</span>
          </div>
        </div>
      )}

      <div className="home-spacer" />

      {scopePickerVisible && (
        <StudyScopePicker
          kind={scope.kind}
          tabs={tabCounts}
          selected={scope.kind === "tabs" ? scope.tabs : []}
          onKindChange={handleKindChange}
          onSelectedChange={handleSelectedChange}
        />
      )}

      {retryQueueLength > 0 && (
        <p className="retry-indicator">
          <span className="retry-indicator-dot" />
          미전송 기록 {retryQueueLength}건 · 연결되면 자동 저장
        </p>
      )}

      {/* 선택 0개면 세션 수 줄을 숨긴다 — 시작 버튼의 "탭을 선택하세요"가 대신 안내한다(§4.2). */}
      {status === "ready" && stats && !noTabSelected && (
        <p className="session-count">
          {scopeLabel ? (
            <>
              <span className="session-count-scope-name">{scopeLabel.name}</span>
              <span className="session-count-rest">
                {scopeLabel.rest} · 오늘 세션 · {stats.sessionCount}문제
              </span>
            </>
          ) : (
            <>오늘 세션 · {stats.sessionCount}문제</>
          )}
        </p>
      )}

      {status !== "error" && (
        <button type="button" className="start-button" disabled={!canStart} onClick={handleStart}>
          {startLabel}
        </button>
      )}
    </div>
  );
}

export default HomeScreen;
