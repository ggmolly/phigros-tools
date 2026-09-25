import { Link, useLoaderData, useNavigate, useRouterState } from "@tanstack/react-router";
import type { KeyboardEvent } from "react";
import { useSave } from "../save-context";

/** Positions (x%, y%, size) for the drifting bokeh dots, shared by the dashboard and the static reference pages. */
const BOKEH: [number, number, number][] = [
  [12, 18, 70],
  [86, 12, 46],
  [94, 48, 80],
  [30, 92, 58],
  [62, 70, 36],
  [6, 84, 90],
  [48, 6, 30],
];

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      {BOKEH.map(([x, y, size], index) => (
        <span
          key={`${x}-${y}`}
          className="bokeh"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: size,
            height: size,
            animationDelay: `${index * -4}s`,
          }}
        />
      ))}
    </div>
  );
}

/** Link to the repo, with the star count the root loader fetched while rendering on the server (see src/stars.ts). */
function GithubLink() {
  const stars = useLoaderData({ from: "__root__" });
  return (
    <a
      className="github-link"
      href="https://github.com/ggmolly/phigros-tools"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="phigros-tools on GitHub"
    >
      <svg className="github-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
      {stars != null && <span className="github-stars">★ {stars.toLocaleString("en")}</span>}
    </a>
  );
}

export type TabId = "/" | "/records" | "/collection" | "/history" | "/charts";
export const TAB_LABEL: Record<TabId, string> = {
  "/": "Overview",
  "/records": "Records",
  "/collection": "Collection",
  "/history": "History",
  "/charts": "Charts",
};
const slug = (id: TabId) => TAB_LABEL[id].toLowerCase();

/** The save-analyzer tabs that have something to show right now. */
export function toolTabs(hasSave: boolean, hasSnapshots: boolean): TabId[] {
  if (hasSave) return ["/", "/records", "/collection", "/history"];
  return hasSnapshots ? ["/", "/history"] : ["/"];
}

/** Every page's header: brand mark, GitHub link and the tabs (the tool's sections plus Charts), then the page's own actions. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  const { loaded, snapshots } = useSave();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tabIds = [...toolTabs(!!loaded, snapshots.length > 0), "/charts" as const];
  const activeTab: TabId = pathname.startsWith("/charts")
    ? "/charts"
    : (tabIds.find((id) => id === pathname) ?? "/");
  function tabKeys(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabIds[(tabIds.indexOf(activeTab) + step + tabIds.length) % tabIds.length]!;
    void navigate({ to: next });
    document.getElementById(`tab-${slug(next)}`)?.focus();
  }
  return (
    <header className="topbar">
      <Link className="corner brand" to="/" aria-label="phigros.tools home">
        <span className="brand-name">
          phigros<span className="brand-dot">.</span>
          <span className="brand-sub">tools</span>
        </span>
      </Link>
      <GithubLink />
      <div className="tabs" role="tablist" aria-label="Sections" onKeyDown={tabKeys}>
        {tabIds.map((id) => (
          <Link
            key={id}
            to={id}
            id={`tab-${slug(id)}`}
            role="tab"
            className="tab"
            aria-selected={activeTab === id}
            aria-controls={activeTab === id && id !== "/charts" ? `panel-${slug(id)}` : undefined}
            tabIndex={activeTab === id ? 0 : -1}
          >
            {TAB_LABEL[id]}
          </Link>
        ))}
      </div>
      {children}
    </header>
  );
}

/** On every page (rendered by the root route): credit on the left, disclaimer on the right. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>
        Made with <span aria-hidden="true">♥</span>
        <span className="sr-only">love</span> by{" "}
        <a href="https://github.com/ggmolly" target="_blank" rel="noopener noreferrer">
          ggmolly
        </a>
      </span>
      <span className="disclaimer">
        Unofficial third-party tool · Not affiliated with Pigeon Games.
      </span>
    </footer>
  );
}
