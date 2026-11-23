import { createFileRoute, Link } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { ModMedia } from "../components/mods";
import { ReleaseFacts } from "../components/releases";
import { useT } from "../i18n";
import { getReleases } from "../releases";
import { headT, pageLinks, pageMeta } from "../seo";

export const Route = createFileRoute("/releases/")({
  loader: () => getReleases(),
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.releasesPage.title,
        description: t.releasesPage.description,
        path: "/releases",
        locale,
      }),
      links: pageLinks("/releases", locale),
    };
  },
  component: ReleasesPage,
});

/** What each release of Phigros++ and each change of the site brought, newest first and biggest. */
function ReleasesPage() {
  const { notes } = Route.useLoaderData();
  const t = useT();
  return (
    <>
      <SiteHeader />
      <main className="app-shell mods-page">
        <div className="leaderboard-head">
          <div>
            <h1>{t.releasesPage.title}</h1>
            <p className="ppp-cta">{t.releasesPage.description}</p>
          </div>
          <Link to="/phigrospp" className="btn btn-ghost">
            {t.ppp.get} <Arrow />
          </Link>
        </div>
        <ul className="mods releases">
          {notes.map((note, index) => (
            <li key={note.slug}>
              <article className="panel mod release">
                {note.shown && (
                  <ModMedia {...note.shown} folder="/releases/" slanted eager={index === 0} />
                )}
                <h2 className="mod-name">
                  <Link className="card-link" to="/releases/$slug" params={{ slug: note.slug }}>
                    {note.title}
                  </Link>
                </h2>
                <ReleaseFacts release={note} />
                <p className="mod-text">{note.summary}</p>
              </article>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
