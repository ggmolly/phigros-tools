import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { DocsHeader, DocsSearch } from "../components/docs";
import { docsHead } from "../docs";

const DESCRIPTION =
  "Make mods for Phigros++ in Lua, from a first mod on your device to one players install from the game, with every function of the API.";

export const Route = createFileRoute("/docs/")({
  head: () => docsHead("Phigros++ docs", DESCRIPTION, ""),
  component: DocsHome,
});

/** The docs' groups of pages, each page with what it's about, under the search. */
function DocsHome() {
  const docs = useLoaderData({ from: "/docs" });
  return (
    <>
      <DocsHeader />
      <main className="app-shell mods-page docs-home">
        <div className="leaderboard-head">
          <div>
            <h1>Phigros++ docs</h1>
            <p className="ppp-cta">{DESCRIPTION}</p>
          </div>
          <Link to="/docs/$" params={{ _splat: "your-first-mod" }} className="btn">
            Your first mod <Arrow />
          </Link>
        </div>
        <DocsSearch />
        {docs.groups.map((group) => (
          <section key={group.title} className="docs-group">
            <h2>{group.title}</h2>
            <ul className="mods">
              {group.pages.map((page) => (
                <li key={page.slug}>
                  <article className="panel mod">
                    <h3 className="mod-name">
                      <Link className="card-link" to="/docs/$" params={{ _splat: page.slug }}>
                        {page.title}
                      </Link>
                    </h3>
                    <p className="mod-text">{page.summary}</p>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
