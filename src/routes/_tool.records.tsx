import { createFileRoute } from "@tanstack/react-router";
import { ChartTable } from "../components/chart-table";
import { useSave } from "../save-context";
import { headT, pageMeta } from "../seo";

export const Route = createFileRoute("/_tool/records")({
  // Empty without a save, so kept out of search results; "/" is the page to index.
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: [
        ...pageMeta({
          title: t.seo.recordsTitle,
          description: t.seo.recordsDescription,
          path: "/records",
          locale,
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: RecordsRoute,
});

function RecordsRoute() {
  const { loaded } = useSave();
  if (!loaded) return null; // _tool.tsx redirects to "/" when nothing is loaded
  return (
    <div id="panel-records" role="tabpanel" aria-labelledby="tab-records" className="tab-panel">
      <ChartTable key={loaded.document.source.importedAt} document={loaded.document} />
    </div>
  );
}
