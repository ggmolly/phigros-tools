import { createFileRoute } from "@tanstack/react-router";
import { ChartTable } from "../components/chart-table";
import { useSave } from "../save-context";

export const Route = createFileRoute("/_tool/records")({
  head: () => ({
    meta: [{ title: "Chart Records — Phigros Tools" }],
  }),
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
