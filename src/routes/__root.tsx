import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useEffect } from "react";
import { Backdrop, SiteFooter, SiteHeader } from "../components/chrome";
import { fogStyle } from "../palettes";
import { SaveProvider } from "../save-context";
import { pageMeta, SITE_DESCRIPTION, SITE_NAME } from "../seo";
import { getStars } from "../stars";
import stylesheet from "../style.css?url";

// our goal is just to know if we have users, we don't want to track them
function Analytics() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    const ref = document.referrer;
    let referrer: string | null = null;
    try {
      if (ref && new URL(ref).hostname !== location.hostname) referrer = new URL(ref).hostname;
    } catch {}
    fetch("/api/beacon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ path: pathname, referrer }),
    }).catch(() => {});
  }, [pathname]);
  return null;
}

// Shared by every page (the save-analyzer tabs and the /charts reference pages): the fog backdrop, the
// footer, and the loaded save, so following a song link and coming back keeps it. The tool's layout is in routes/_tool.tsx.
function Root() {
  return (
    <SaveProvider>
      <Backdrop />
      <Analytics />
      <Outlet />
      <SiteFooter />
    </SaveProvider>
  );
}

export const Route = createRootRoute({
  // Server-rendered with the page; never refetched on client navigation.
  loader: () => getStars().catch(() => null),
  staleTime: Number.POSITIVE_INFINITY,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      ...pageMeta({ title: SITE_NAME, description: SITE_DESCRIPTION, path: "/" }),
    ],
    links: [
      {
        rel: "preload",
        href: "/fonts/Saira.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "stylesheet", href: stylesheet },
    ],
  }),
  shellComponent: ({ children }) => (
    // The default fog is set inline so the first paint already has it (see DEFAULT_PALETTE).
    <html lang="en" style={fogStyle() as CSSProperties}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  ),
  component: Root,
  notFoundComponent: () => (
    <>
      <SiteHeader />
      <main className="app-shell">
        <section className="panel">
          <h1 className="panel-title">Page Not Found</h1>
          <p className="meta">
            Nothing lives at this address. <Link to="/">Open your save</Link> or{" "}
            <Link to="/charts">browse the chart list</Link>.
          </p>
        </section>
      </main>
    </>
  ),
});
