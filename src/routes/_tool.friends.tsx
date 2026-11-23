import { createFileRoute } from "@tanstack/react-router";
import { FriendsPanel } from "../components/friends";
import { useProfileCredential } from "../components/phigrospp";
import { headT, pageMeta } from "../seo";

export const Route = createFileRoute("/_tool/friends")({
  // only for a signed-in Phigros++ profile, so kept out of search results
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: [
        ...pageMeta({ title: t.tabs.friends, description: t.ppp.pitch, path: "/friends", locale }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: FriendsRoute,
});

function FriendsRoute() {
  const credential = useProfileCredential();
  if (!credential) return null; // _tool.tsx redirects to "/" when the open save isn't a profile's
  return (
    <div className="tab-panel">
      <FriendsPanel key={credential.playerId} credential={credential} />
    </div>
  );
}
