import type { PronunciationButtonProps, PronunciationStatus } from "../lib/ttsTypes.ts";
import "./PronunciationButton.css";

const inputReasonMessage = {
  text_too_long: "발음은 200자까지 지원해요.",
  invalid_text: "읽을 표제어가 없어요.",
} as const;

function SpeakerIcon() {
  return (
    <svg
      className="pronunciation-button__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 9.5v5h3l4 3.5V6l-4 3.5z" />
      <path d="M15 9a4 4 0 0 1 0 6" />
      <path d="M17.5 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

function LoadingIcon() {
  return <span className="pronunciation-button__spinner" aria-hidden="true" />;
}

function statusDescription(status: PronunciationStatus) {
  switch (status) {
    case "loading":
      return "발음을 준비하고 있어요.";
    case "playing":
      return "발음을 재생하고 있어요.";
    default:
      return null;
  }
}

export default function PronunciationButton({ snapshot, replay }: PronunciationButtonProps) {
  const inputMessage = snapshot.inputReason ? inputReasonMessage[snapshot.inputReason] : null;
  const description = inputMessage ?? statusDescription(snapshot.status);
  const disabled = !snapshot.enabled || snapshot.inputReason !== null;
  const message = snapshot.message ?? inputMessage;

  return (
    <div className={`pronunciation-button pronunciation-button--${snapshot.status}`}>
      <button
        type="button"
        className="pronunciation-button__control"
        aria-label="발음 듣기"
        aria-busy={snapshot.status === "loading" ? "true" : undefined}
        aria-describedby={description ? "pronunciation-button-description" : undefined}
        disabled={disabled}
        onClick={replay}
      >
        {snapshot.status === "loading" ? <LoadingIcon /> : <SpeakerIcon />}
      </button>
      <div
        id="pronunciation-button-description"
        className="pronunciation-button__message"
        aria-live={snapshot.message ? "polite" : undefined}
      >
        {message}
      </div>
    </div>
  );
}
