import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "../components/chrome";
import { Rebuild } from "../components/rebuild";
import { headT, pageMeta } from "../seo";

export const Route = createFileRoute("/rebuild")({
  // a tool for one player's save, reached from /start: kept out of search results
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: [
        ...pageMeta({
          title: t.rebuild.title,
          description: t.rebuild.description,
          path: "/rebuild",
          locale,
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: () => (
    <>
      <SiteHeader />
      <main className="app-shell ppp-page">
        <Rebuild />
      </main>
    </>
  ),
});
