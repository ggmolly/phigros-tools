import { createFileRoute } from "@tanstack/react-router";
import { MainMenu } from "../components/main-menu";
import { Overview } from "../components/overview";
import { useSave } from "../save-context";
import { jsonLd, SITE, SITE_DESCRIPTION, SITE_NAME } from "../seo";

export const Route = createFileRoute("/_tool/")({
  head: () => ({
    scripts: [
      jsonLd({
        "@type": "WebSite",
        name: SITE_NAME,
        alternateName: "phigros.tools",
        url: `${SITE}/`,
        description: SITE_DESCRIPTION,
      }),
    ],
  }),
  component: OverviewRoute,
});

function OverviewRoute() {
  const { loaded, credentials } = useSave();
  const loadedCredential = loaded && credentials.find((c) => c.playerId === loaded.playerId);
  return (
    <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="tab-panel">
      {loaded ? (
        <Overview
          key={loaded.document.source.importedAt}
          document={loaded.document}
          playerName={loadedCredential?.nickname}
        />
      ) : (
        <MainMenu />
      )}
    </div>
  );
}
