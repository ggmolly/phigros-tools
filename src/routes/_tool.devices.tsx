import { createFileRoute } from "@tanstack/react-router";
import { DevicesPanel, useProfileCredential } from "../components/phigrospp";
import { headT, pageMeta } from "../seo";

export const Route = createFileRoute("/_tool/devices")({
  // only for a signed-in Phigros++ profile, so kept out of search results
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: [
        ...pageMeta({ title: t.tabs.devices, description: t.ppp.pitch, path: "/devices", locale }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: DevicesRoute,
});

function DevicesRoute() {
  const credential = useProfileCredential();
  if (!credential) return null; // _tool.tsx redirects to "/" when the open save isn't a profile's
  return (
    <div id="panel-devices" role="tabpanel" aria-labelledby="tab-devices" className="tab-panel">
      <DevicesPanel key={credential.playerId} credential={credential} />
    </div>
  );
}
