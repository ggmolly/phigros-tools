import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Readme } from "../components/mods";
import { ReleaseContents, ReleaseFacts } from "../components/releases";
import { useT } from "../i18n";
import { getRelease, releaseImage } from "../releases";
import { headT, jsonLd, localeUrl, pageLinks, pageMeta } from "../seo";

// link previews show the note's title and what it shows first (server/card.tsx)
export const Route = createFileRoute("/releases/$slug")({
  loader: async ({ params }) => {
    const found = await getRelease({ data: params.slug });
    if (!found) throw notFound();
    return found;
  },
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const { locale } = headT(match);
    const { note } = loaderData;
    const path = `/releases/${note.slug}`;
    const image = releaseImage(note);
    return {
      meta: pageMeta({ title: note.title, description: note.summary, path, locale, image }),
      links: pageLinks(path, locale),
      scripts: [
        jsonLd({
          "@type": "BlogPosting",
          headline: note.title,
          description: note.summary,
          datePublished: note.date,
          image: image.url,
          url: localeUrl(path, locale),
        }),
      ],
    };
  },
  component: ReleasePage,
});

/** A release note, laid out like a mod's page: its title, its sections and the notes around it beside what it says. */
function ReleasePage() {
  const { note, newer, older } = Route.useLoaderData();
  const t = useT();
  const sections = note.blocks.flatMap((block) =>
    block.kind === "heading" && block.level === 2 ? [block.spans] : [],
  );
  return (
    <>
      <SiteHeader />
      <main className="app-shell mods-page mod-page">
        <div className="chart-player-bar">
          <Link to="/releases" className="btn btn-ghost">
            <span className="chart-player-back">
              <Arrow />
            </span>
            {t.releasesPage.title}
          </Link>
        </div>
        <div className="mod-side">
          <section className="panel mod mod-hero release">
            <h1 className="mod-name">{note.title}</h1>
            <ReleaseFacts release={note} />
            {sections.length > 1 && (
              <ReleaseContents sections={sections} label={t.releasesPage.contents} />
            )}
            {note.phigrospp && (
              <footer>
                <Link className="btn" to="/phigrospp">
                  {t.ppp.get} <Arrow />
                </Link>
              </footer>
            )}
          </section>
          {(newer || older) && (
            <nav className="release-around">
              {[newer, older].map(
                (around) =>
                  around && (
                    <Link
                      key={around.slug}
                      className={around === newer ? "newer" : undefined}
                      to="/releases/$slug"
                      params={{ slug: around.slug }}
                    >
                      {around.title} <Arrow />
                    </Link>
                  ),
              )}
            </nav>
          )}
        </div>
        <section className="panel release-note">
          <Readme blocks={note.blocks} folder="/releases/" />
        </section>
      </main>
    </>
  );
}
