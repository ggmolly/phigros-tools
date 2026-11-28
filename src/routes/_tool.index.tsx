import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Features, MainMenu } from "../components/main-menu";
import { Overview } from "../components/overview";
import { PhigrosppBar } from "../components/phigrospp";
import { useLiveReload } from "../live";
import { getProfile, type PlayerProfile } from "../plays";
import { getReleases } from "../releases";
import { useSave } from "../save-context";
import { headT, jsonLd, localeUrl, pageMeta, SITE_NAME } from "../seo";
import { topics } from "../topics";

export const Route = createFileRoute("/_tool/")({
  // the release notes whose covers show what Phigros++ adds
  loader: () => getReleases(),
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.seo.siteTitle,
        description: t.seo.siteDescription,
        path: "/",
        locale,
      }),
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
  const { notes } = Route.useLoaderData();
  const loadedCredential = loaded && credentials.find((c) => c.playerId === loaded.playerId);
  // a Phigros++ save is the player's public page too: the server rendered it with the page, or it's fetched once the
  // player signs in here, and again when it changes
  const profileId = account === loaded?.playerId ? account : undefined;
  const [fetched, setFetched] = useState<PlayerProfile>();
  const rendered = home?.id === profileId ? home?.profile : undefined;
  const fetch = () =>
    void getProfile({ data: profileId! }).then((found) => setFetched(found ?? undefined));
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetches once per profile; fetch isn't wrapped in useCallback (the React Compiler handles memoisation).
  useEffect(() => {
    if (profileId && !rendered) fetch();
  }, [profileId, rendered]);
  useLiveReload([profileId && topics.player(profileId), profileId && topics.ranking], fetch);
  const profile = (fetched?.player.id === profileId ? fetched : undefined) ?? rendered;
  const navigate = useNavigate();
  const masked = useRouterState({ select: (state) => !!state.location.maskedLocation });
  // false once a navigation away has started: this tab is still mounted then, and must not pull the address back
  const here = useRouterState({ select: (state) => state.location.pathname === "/" });
  // the address bar shows the profile's public url so it can be copied, and goes back to / once signed out. the router
  // skips a navigation to the same path and state, so the state names the profile
  useEffect(() => {
    if (here && !!profileId !== masked)
      void navigate({
        to: "/",
        replace: true,
        state: { profile: profileId },
        mask: profileId ? { to: "/players/$id", params: { id: profileId } } : undefined,
      });
  }, [profileId, masked, here, navigate]);
  return (
    <div className="tab-panel">
      {loaded && <PhigrosppBar />}
      {loaded ? (
        <Overview
          key={loaded.document.source.importedAt}
          document={loaded.document}
          playerName={loadedCredential?.nickname ?? rendered?.player.name}
          profile={profile}
        />
      ) : (
        <>
          <MainMenu />
          <Features notes={notes} />
        </>
      )}
    </div>
  );
}
