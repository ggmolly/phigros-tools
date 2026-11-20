import { createFileRoute, Link } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { ModFacts, ModMedia } from "../components/mods";
import { useT } from "../i18n";
import { getMods, modImage, modLink } from "../mods";
import { headT, pageLinks, pageMeta } from "../seo";

const PUBLISH = "https://github.com/ggmolly/PhigrosPlusPlus/wiki/Publishing-a-mod";

export const Route = createFileRoute("/mods/")({
  loader: () => getMods(),
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.tabs.mods,
        description: t.modsPage.description,
        path: "/mods",
        locale,
        image: modImage(),
      }),
      links: pageLinks("/mods", locale),
    };
  },
  component: ModsPage,
});

/** The Phigros++ mod catalog, as the game's Mods tab lists it: a row per mod, its clip on the game's slant. */
function ModsPage() {
  const mods = Route.useLoaderData();
  const t = useT();
  const p = t.modsPage;
  return (
    <>
      <SiteHeader />
      <main className="app-shell mods-page">
        <div className="leaderboard-head">
          <div>
            <h1>{t.tabs.mods}</h1>
            <p className="ppp-cta">{p.description}</p>
          </div>
          <a className="btn btn-ghost" href={PUBLISH} target="_blank" rel="noopener noreferrer">
            {p.publish} <Arrow />
          </a>
        </div>
        {mods.length === 0 && (
          <section className="panel">
            <p className="meta">{p.empty}</p>
          </section>
        )}
        <ul className="mods">
          {mods.map((mod) => (
            <li key={mod.repo}>
              <article className="panel mod">
                {mod.poster && (
                  <ModMedia poster={mod.poster} clip={mod.clip} width={640} height={360} slanted />
                )}
                <h2 className="mod-name">
                  <Link
                    className="card-link"
                    to="/mods/$owner/$name"
                    params={ownerAndName(mod.repo)}
                  >
                    {mod.name}
                  </Link>
                </h2>
                <ModFacts mod={mod} />
                <p className="mod-text">{mod.description}</p>
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
              </article>
            </li>
          ))}
        </ul>
        <p className="footnote">{t.pppPage.installNote}</p>
      </main>
    </>
  );
}

const ownerAndName = (repo: string) => {
  const [owner, name] = repo.split("/") as [string, string];
  return { owner, name };
};
