import { createFileRoute } from "@tanstack/react-router";
import { CollectionTracker } from "../components/collection";
import { useSave } from "../save-context";
import { headT, pageMeta } from "../seo";

export const Route = createFileRoute("/_tool/collection")({
  // Empty without a save, so kept out of search results; "/" is the page to index.
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: [
        ...pageMeta({
          title: t.seo.collectionTitle,
          description: t.seo.collectionDescription,
          path: "/collection",
          locale,
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
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
