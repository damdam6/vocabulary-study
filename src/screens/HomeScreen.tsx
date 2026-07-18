// design-prd §3 홈 화면
import { useEffect, useState } from "react";
import { formatHomeDate } from "../lib/date.ts";
import { computeHomeStats, type HomeStats } from "../lib/homeStats.ts";
import { RETRY_QUEUE_CHANGED_EVENT, RETRY_QUEUE_STORAGE_KEY, getRetryQueueLength } from "../lib/retryQueue.ts";
import { getSeoulToday } from "../lib/wordState.ts";
import { fetchWords } from "../lib/wordsApi.ts";

interface HomeScreenProps {
  onStart: () => void
}

type Status = "loading" | "error" | "ready";

function HomeScreen({ onStart }: HomeScreenProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [retryQueueLength, setRetryQueueLength] = useState(0);

  // App.tsx가 홈 화면을 조건부로만 렌더링하므로, 홈을 벗어났다 돌아올 때마다
  // 이 컴포넌트가 새로 마운트되어 design-prd §3의 "홈 진입 시마다 재조회"를 만족한다.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setStatus("loading");
    fetchWords(controller.signal)
      .then((words) => {
        if (cancelled) return;
        setStats(computeHomeStats(words, getSeoulToday()));
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

  const canStart = status === "ready" && (stats?.sessionCount ?? 0) > 0;

  return (
    <div className="home-screen">
      <p className="home-date">{formatHomeDate()}</p>
      <h1 className="home-title">오늘의 학습</h1>

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

      {retryQueueLength > 0 && (
        <p className="retry-indicator">
          <span className="retry-indicator-dot" />
          미전송 기록 {retryQueueLength}건 · 연결되면 자동 저장
        </p>
      )}

      {status === "ready" && stats && <p className="session-count">오늘 세션 · {stats.sessionCount}문제</p>}

      {status !== "error" && (
        <button type="button" className="start-button" disabled={!canStart} onClick={onStart}>
          {status === "loading" ? "불러오는 중…" : canStart ? "학습 시작" : "오늘 할 것 없음"}
        </button>
      )}
    </div>
  );
}

export default HomeScreen;
