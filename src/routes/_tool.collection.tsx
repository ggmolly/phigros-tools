import { createFileRoute } from "@tanstack/react-router";
import { CollectionTracker } from "../components/collection";
import { useSave } from "../save-context";

export const Route = createFileRoute("/_tool/collection")({
  head: () => ({
    meta: [{ title: "Collection — Phigros Tools" }],
  }),
  component: CollectionRoute,
});

function CollectionRoute() {
  const { loaded } = useSave();
  if (!loaded) return null; // _tool.tsx redirects to "/" when nothing is loaded
  return (
    <div
      id="panel-collection"
      role="tabpanel"
      aria-labelledby="tab-collection"
      className="tab-panel"
    >
      <CollectionTracker key={loaded.document.source.importedAt} document={loaded.document} />
    </div>
  );
}
