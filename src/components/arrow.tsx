export function Arrow() {
  return (
    <svg
      className="button-arrow"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </svg>
  );
}
export function SyncIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      className={`button-arrow sync-icon${spinning ? " spinning" : ""}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M19 12a7 7 0 0 1-12.5 4.3M5 12a7 7 0 0 1 12.5-4.3M18 3.5v4.3h-4.3M6 20.5v-4.3h4.3" />
    </svg>
  );
}
