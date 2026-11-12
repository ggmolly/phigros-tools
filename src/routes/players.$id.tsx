import { createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteHeader } from "../components/chrome";
import { useProfileCredential } from "../components/phigrospp";
import { Card, RecentActivity, RecentPlays, TopPlays } from "../components/player";
import { RksHistory } from "../components/rks-history";
import { useLive } from "../live";
import { CARDS, getProfile } from "../plays";
import { useSave } from "../save-context";
import { headT, pageMeta, SITE } from "../seo";

// players' pages change with every upload and unlisted ones must stay out of search results, so none are indexed. their
// link previews show the player's card (server/card.tsx)
export const Route = createFileRoute("/players/$id")({
  loader: async ({ params }) => {
    const profile = await getProfile({ data: params.id });
    if (!profile) throw notFound();
    return profile;
  },
  head: ({ params, loaderData: profile, match }) => {
    const { locale, t } = headT(match);
    if (!profile) return {};
    const { stats } = profile;
    const tag = `${profile.player.name}#${String(profile.player.number).padStart(4, "0")}`;
    const rks = `RKS ${profile.rks.toFixed(3)}`;
    return {
      meta: [
        ...pageMeta({
          title: tag,
          description: [
            rks,
            profile.rank && `${t.profile.globalRank} #${profile.rank}`,
            `${t.common.cleared} ${stats.cleared} · FC ${stats.fc} · φ ${stats.phi}`,
            stats.accuracy !== null && `${t.profile.accuracy} ${stats.accuracy.toFixed(2)}%`,
            profile.intro,
          ]
            .filter(Boolean)
            .join(" · "),
          path: `/players/${params.id}`,
          locale,
          themeColor: profile.themeColor,
          image: {
            url: `${SITE}/og/player/${params.id}.jpg?rks=${profile.rks.toFixed(3)}`,
            ...CARDS.player,
            alt: `${tag}, ${rks}`,
          },
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: PlayerPage,
});

function PlayerPage() {
  const profile = Route.useLoaderData();
  const { loaded } = useSave();
  const navigate = useNavigate();
  const router = useRouter();
  useLive(profile.player.id, () => void router.invalidate());
  const mine = useProfileCredential()?.playerId === profile.player.id;
  // a player's own page is their Overview, with their save around it
  useEffect(() => {
    if (mine && loaded) void navigate({ to: "/", replace: true });
  }, [mine, loaded, navigate]);
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <Card profile={profile} />
        <RksHistory history={profile.history} />
        <TopPlays profile={profile} />
        <RecentActivity profile={profile} />
        <RecentPlays profile={profile} />
      </main>
    </>
  );
}
