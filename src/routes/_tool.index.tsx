import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MainMenu } from "../components/main-menu";
import { Overview } from "../components/overview";
import { PhigrosppBar } from "../components/phigrospp";
import { getProfile, type PlayerProfile } from "../plays";
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
  const { loaded, credentials, account, home } = useSave();
  const loadedCredential = loaded && credentials.find((c) => c.playerId === loaded.playerId);
  // a Phigros++ save is the player's public page too: the server rendered it with the page, or it's fetched once the
  // player signs in here
  const profileId = account === loaded?.playerId ? account : undefined;
  const [fetched, setFetched] = useState<PlayerProfile>();
  const rendered = home?.id === profileId ? home?.profile : undefined;
  useEffect(() => {
    if (profileId && !rendered)
      void getProfile({ data: profileId }).then((found) => setFetched(found ?? undefined));
  }, [profileId, rendered]);
  const profile = rendered ?? (fetched?.player.id === profileId ? fetched : undefined);
  return (
    <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="tab-panel">
      {loaded && <PhigrosppBar />}
      {loaded ? (
        <Overview
          key={loaded.document.source.importedAt}
          document={loaded.document}
          playerName={loadedCredential?.nickname ?? rendered?.player.name}
          profile={profile}
        />
      ) : (
        <MainMenu />
      )}
    </div>
  );
}
