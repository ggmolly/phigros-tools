import { Link, useLoaderData, useRouterState } from "@tanstack/react-router";
import { Fragment, useEffect } from "react";
import { setLocale, useFormat, useLocale, useT } from "../i18n";
import { isLocale, LOCALE_NAME, LOCALES } from "../i18n/locales";
import { report } from "../report";
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

/** Links to the Discord server and the repo, with the star count the root loader fetched while rendering on the server (see src/stars.ts). */
function HeaderLinks() {
  const { stars } = useLoaderData({ from: "__root__" });
  const t = useT();
  const format = useFormat();
  return (
    <div className="header-links">
      <a
        className="header-link"
        href="https://discord.gg/SY377cGuAn"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg className="header-icon" viewBox="0 0 24 24" fill="currentColor">
          <title>Discord</title>
          <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
        </svg>
      </a>
      <a
        className="header-link"
        href="https://github.com/ggmolly/phigros-tools"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t.header.github}
      >
        <svg className="header-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        {stars != null && <span className="github-stars">★ {format.number(stars)}</span>}
      </a>
    </div>
  );
}

export type TabId =
  | "/"
  | "/records"
  | "/friends"
  | "/devices"
  | "/charts"
  | "/leaderboard"
  | "/rooms"
  | "/mods"
  | "/phigrospp";
/** The tab ids double as their message keys. */
export const TAB_KEY = {
  "/": "overview",
  "/records": "records",
  "/friends": "friends",
  "/devices": "devices",
  "/charts": "charts",
  "/leaderboard": "leaderboard",
  "/rooms": "rooms",
  "/mods": "mods",
  "/phigrospp": "phigrospp",
} as const satisfies Record<TabId, string>;

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

/** The save-analyzer tabs that have something to show right now: a save has Records, a Phigros++ profile's Friends and Devices. */
export function toolTabs(hasSave: boolean, signedIn: boolean): TabId[] {
  if (!hasSave) return ["/"];
  return signedIn ? ["/", "/records", "/friends", "/devices"] : ["/", "/records"];
}

/** Every page's header: brand mark, the tabs (the tool's sections plus Charts), the page's own actions, then the Discord and GitHub links at the far right. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  const { loaded, account, home } = useSave();
  const t = useT();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const signedIn = !!account && account === loaded?.playerId;
  const tabIds = [
    ...toolTabs(!!loaded, signedIn),
    "/charts" as const,
    "/leaderboard" as const,
    "/rooms" as const,
    "/mods" as const,
    "/phigrospp" as const,
  ];
  // a chart's ranking, a player's page and a replay are reached from the leaderboard
  const activeTab: TabId | undefined =
    pathname.startsWith("/leaderboard") ||
    pathname.startsWith("/players/") ||
    pathname.startsWith("/replays/") ||
    /^\/charts\/[^/]+\/plays\//.test(pathname)
      ? "/leaderboard"
      : pathname.startsWith("/charts")
        ? "/charts"
        : pathname.startsWith("/mods")
          ? "/mods"
          : pathname.startsWith("/rooms")
            ? "/rooms"
            : pathname === "/start" || pathname === "/rebuild"
              ? "/phigrospp"
              : (tabIds.find((id) => id === pathname) ??
                // no tab leads to the admin's page or to the release notes
                (/^\/(admin|releases)\b/.test(pathname) ? undefined : "/"));
  return (
    <header className="topbar">
      <Link className="corner brand" to="/" aria-label={t.header.home}>
        <span className="brand-name">
          phigros<span className="brand-dot">.</span>
          <span className="brand-sub">tools</span>
        </span>
      </Link>
      <nav className="tabs" aria-label={t.tabs.label}>
        {tabIds.map((id) => (
          <Link
            key={id}
            to={id}
            className="tab"
            // exact, or the router also marks "/" and "/charts" as current on the pages under them
            activeOptions={{ exact: true }}
            aria-current={activeTab === id ? "page" : undefined}
          >
            {/* a Phigros++ save's Overview is its player's profile */}
            {id === "/" && signedIn ? t.tabs.profile : t.tabs[TAB_KEY[id]]}
          </Link>
        ))}
        {/* only who data/config.toml names sees it (server/admin.ts) */}
        {home?.profile.roles.includes("admin") && (
          <Link
            to="/admin"
            className="tab"
            aria-current={pathname === "/admin" ? "page" : undefined}
          >
            Admin
          </Link>
        )}
      </nav>
      {children}
      <HeaderLinks />
    </header>
  );
}

/** What a page that threw shows in its place, once the server is told (src/report.ts). */
export function PageError({ error }: { error: unknown }) {
  const t = useT();
  useEffect(() => report("render", error), [error]);
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <section className="panel">
          <h1 className="panel-title">{t.crashed.title}</h1>
          <p className="meta">{t.crashed.body}</p>
          <button type="button" className="btn" onClick={() => location.reload()}>
            {t.crashed.reload}
          </button>
        </section>
      </main>
    </>
  );
}

/**
 * On every page (rendered by the root route): credit and the latest Phigros++, which opens the release notes, on the
 * left, disclaimer and language switcher on the right.
 */
export function SiteFooter() {
  const t = useT();
  const { phigrospp } = useLoaderData({ from: "__root__" });
  return (
    <footer className="site-footer">
      <span className="footer-group">
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
        <Link to="/releases">{phigrospp ? `Phigros++ ${phigrospp}` : t.releasesPage.title}</Link>
      </span>
      <span className="footer-group">
        <span className="disclaimer">{t.footer.disclaimer}</span>
        <LanguageSwitch />
      </span>
    </footer>
  );
}
