import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { ModFacts, ModMedia, Readme } from "../components/mods";
import { useT } from "../i18n";
import { getMod, type Media, modImage, modLink } from "../mods";
import { headT, pageLinks, pageMeta } from "../seo";

// link previews show the mod's name, author and what its README shows first (server/card.tsx)
export const Route = createFileRoute("/mods/$owner/$name")({
  loader: async ({ params }) => {
    const found = await getMod({ data: `${params.owner}/${params.name}` });
    if (!found) throw notFound();
    return found;
  },
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const { locale } = headT(match);
    const { mod } = loaderData;
    return {
      meta: pageMeta({
        title: mod.name,
        description: mod.description,
        path: `/mods/${mod.repo}`,
        locale,
        image: modImage(mod),
      }),
      links: pageLinks(`/mods/${mod.repo}`, locale),
    };
  },
  component: ModPage,
});

/** A mod's page, like the game's: what it shows beside its name and what opens it, then its README. */
function ModPage() {
  const { mod, blocks } = Route.useLoaderData();
  const t = useT();
  const p = t.modsPage;
  const shown = blocks.find((block): block is Media => block.kind === "media");
  return (
    <>
      <SiteHeader />
      <main className="app-shell mods-page mod-page">
        <div className="chart-player-bar">
          <Link to="/mods" className="btn btn-ghost">
            <span className="chart-player-back">
              <Arrow />
            </span>
            {t.tabs.mods}
          </Link>
        </div>
        <div className="mod-side">
          <section className="panel mod mod-hero">
            {shown && <ModMedia {...shown} slanted />}
            <h1 className="mod-name">{mod.name}</h1>
            <ModFacts mod={mod} />
            <p className="mod-text meta">{p.openNote}</p>
            <footer>
              <a className="btn" href={modLink(mod.repo)}>
                {p.open} <Arrow />
              </a>
              <a
                className="text-link"
                href={`https://github.com/${mod.repo}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.pppPage.source}
              </a>
            </footer>
          </section>
        </div>
        <section className="panel">
          <Readme blocks={blocks} shown={shown} />
        </section>
      </main>
    </>
  );
}
