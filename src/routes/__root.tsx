import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { Backdrop, SiteFooter, SiteHeader } from "../components/chrome";
import { fogStyle } from "../palettes";
import { SaveProvider } from "../save-context";
import { pageMeta, SITE_DESCRIPTION, SITE_NAME } from "../seo";
import { getStars } from "../stars";
import stylesheet from "../style.css?url";

// Shared by every page (the save-analyzer tabs and the /charts reference pages): the fog backdrop, the
// footer, and the loaded save, so following a song link and coming back keeps it. The tool's layout is in routes/_tool.tsx.
function Root() {
  return (
    <SaveProvider>
      <Backdrop />
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
