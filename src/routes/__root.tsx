import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useEffect } from "react";
import { Backdrop, SiteFooter, SiteHeader } from "../components/chrome";
import { getHome } from "../home";
import { I18nProvider, useT } from "../i18n";
import type { Locale } from "../i18n/locales";
import { CountsLive } from "../motion";
import { fogStyle } from "../palettes";
import { SaveProvider } from "../save-context";
import { headT, pageMeta, SITE_NAME } from "../seo";
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
  const { locale, home } = Route.useLoaderData();
  return (
    <I18nProvider locale={locale}>
      <SaveProvider home={home}>
        <Backdrop />
        <Analytics />
        <CountsLive />
        <Outlet />
        <SiteFooter />
      </SaveProvider>
    </I18nProvider>
  );
}

export const Route = createRootRouteWithContext<{ i18n: { locale: Locale } }>()({
  // Server-rendered with the page; never refetched on client navigation. The language comes from the URL
  // prefix (see router.tsx); switching it loads the other prefix.
  loader: async ({ context }) => ({
    stars: await getStars().catch(() => null),
    locale: context.i18n.locale,
    home: await getHome().catch(() => null),
  }),
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      ...pageMeta({
        title: SITE_NAME,
        description: headT(match).t.seo.siteDescription,
        path: "/",
        locale: headT(match).locale,
      }),
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
  shellComponent: ({ children }) => <Shell>{children}</Shell>,
  component: Root,
  notFoundComponent: NotFound,
});

function Shell({ children }: { children: React.ReactNode }) {
  const { locale } = Route.useLoaderData();
  return (
    // The default fog is set inline so the first paint already has it (see DEFAULT_PALETTE).
    <html lang={locale} style={fogStyle() as CSSProperties}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  const t = useT();
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <section className="panel">
          <h1 className="panel-title">{t.notFound.title}</h1>
          <p className="meta">
            {t.notFound.body} <Link to="/">{t.notFound.openSave}</Link> {t.notFound.or}{" "}
            <Link to="/charts">{t.notFound.browseCharts}</Link>.
          </p>
        </section>
      </main>
    </>
  );
}
