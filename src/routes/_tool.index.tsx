import { createFileRoute } from "@tanstack/react-router";
import { MainMenu } from "../components/main-menu";
import { Overview } from "../components/overview";
import { useSave } from "../save-context";
import { headT, jsonLd, localeUrl, SITE_NAME } from "../seo";

export const Route = createFileRoute("/_tool/")({
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      scripts: [
        jsonLd({
          "@type": "WebSite",
          name: SITE_NAME,
          alternateName: "phigros.tools",
          url: localeUrl("/", locale),
          inLanguage: locale,
          description: t.seo.siteDescription,
        }),
      ],
    };
  },
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
