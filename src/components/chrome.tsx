import { Link, useLoaderData, useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment, type KeyboardEvent } from "react";
import { setLocale, useFormat, useLocale, useT } from "../i18n";
import { isLocale, LOCALE_NAME, LOCALES } from "../i18n/locales";
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
  const { stars } = useLoaderData({ from: "__root__" });
  const t = useT();
  const format = useFormat();
  return (
    <a
      className="github-link"
      href="https://github.com/ggmolly/phigros-tools"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t.header.github}
    >
      <svg className="github-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
      {stars != null && <span className="github-stars">★ {format.number(stars)}</span>}
    </a>
  );
}

export type TabId = "/" | "/records" | "/devices" | "/charts" | "/leaderboard" | "/phigrospp";
/** The tab ids double as their message keys. */
export const TAB_KEY = {
  "/": "overview",
  "/records": "records",
  "/devices": "devices",
  "/charts": "charts",
  "/leaderboard": "leaderboard",
  "/phigrospp": "phigrospp",
} as const satisfies Record<TabId, string>;
const slug = (id: TabId) => TAB_KEY[id];

/** Overrides the browser's language; the choice is kept in a cookie and in the URL prefix. */
function LanguageSwitch() {
  const t = useT();
  const locale = useLocale();
  return (
    <select
      className="lang-switch"
      aria-label={t.header.language}
      value={locale}
      onChange={(event) => isLocale(event.target.value) && setLocale(event.target.value)}
    >
      {LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_NAME[code]}
        </option>
      ))}
    </select>
  );
}

/** The save-analyzer tabs that have something to show right now: a save has Records, a Phigros++ profile's Devices. */
export function toolTabs(hasSave: boolean, signedIn: boolean): TabId[] {
  if (!hasSave) return ["/"];
  return signedIn ? ["/", "/records", "/devices"] : ["/", "/records"];
}

/** Every page's header: brand mark, the tabs (the tool's sections plus Charts), the page's own actions, then the GitHub link at the far right. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  const { loaded, account } = useSave();
  const t = useT();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const signedIn = !!account && account === loaded?.playerId;
  // a Phigros++ player has the app already
  const hasApp = !!account;
  const tabIds = [
    ...toolTabs(!!loaded, signedIn),
    "/charts" as const,
    "/leaderboard" as const,
    ...(hasApp ? [] : ["/phigrospp" as const]),
  ];
  // a chart's ranking, a player's page and a replay are reached from the leaderboard
  const activeTab: TabId =
    pathname.startsWith("/leaderboard") ||
    pathname.startsWith("/players/") ||
    pathname.startsWith("/replays/") ||
    /^\/charts\/[^/]+\/plays\//.test(pathname)
      ? "/leaderboard"
      : pathname.startsWith("/charts")
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
      <Link className="corner brand" to="/" aria-label={t.header.home}>
        <span className="brand-name">
          phigros<span className="brand-dot">.</span>
          <span className="brand-sub">tools</span>
        </span>
      </Link>
      <div className="tabs" role="tablist" aria-label={t.tabs.label} onKeyDown={tabKeys}>
        {tabIds.map((id) => (
          <Link
            key={id}
            to={id}
            id={`tab-${slug(id)}`}
            role="tab"
            className="tab"
            aria-selected={activeTab === id}
            aria-controls={
              activeTab === id && id !== "/charts" && id !== "/leaderboard" && id !== "/phigrospp"
                ? `panel-${slug(id)}`
                : undefined
            }
            tabIndex={activeTab === id ? 0 : -1}
          >
            {/* a Phigros++ save's Overview is its player's profile */}
            {id === "/" && signedIn ? t.tabs.profile : t.tabs[TAB_KEY[id]]}
          </Link>
        ))}
      </div>
      {children}
      <GithubLink />
    </header>
  );
}

/** On every page (rendered by the root route): credit on the left, disclaimer and language switcher on the right. */
export function SiteFooter() {
  const t = useT();
  return (
    <footer className="site-footer">
      <span>
        {t.footer
          .credit("\0")
          .split("\0")
          .map((part, index) =>
            index ? (
              <Fragment key={part}>
                <a href="https://github.com/ggmolly" target="_blank" rel="noopener noreferrer">
                  ggmolly
                </a>
                {part}
              </Fragment>
            ) : (
              part
            ),
          )}
      </span>
      <span className="footer-end">
        <span className="disclaimer">{t.footer.disclaimer}</span>
        <LanguageSwitch />
      </span>
    </footer>
  );
}
