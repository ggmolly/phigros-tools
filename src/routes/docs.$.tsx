import { createFileRoute, Link, notFound, useLoaderData } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { DocsHeader, DocsNav } from "../components/docs";
import { Readme } from "../components/mods";
import { docsHead, getDoc } from "../docs";

export const Route = createFileRoute("/docs/$")({
  loader: async ({ params }) => {
    const page = await getDoc({ data: params._splat ?? "" });
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData, params }) =>
    loaderData ? docsHead(loaderData.title, loaderData.summary, params._splat ?? "") : {},
  component: DocsPage,
});

/** A page of the docs beside all of them, then the pages before and after it. */
function DocsPage() {
  const page = Route.useLoaderData();
  const path = Route.useParams()._splat ?? "";
  const docs = useLoaderData({ from: "/docs" });
  // its sections are its biggest headings: a guide's, or the names of a part of the API
  const top = Math.min(
    ...page.blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : [])),
  );
  const sections = page.blocks.flatMap((block) =>
    block.kind === "heading" && block.level === top ? [block.spans] : [],
  );
  const all = docs.groups.flatMap((group) => group.pages);
  const at = all.findIndex((link) => link.slug === path);
  return (
    <>
      <DocsHeader />
      <main className="app-shell mods-page mod-page docs">
        <div className="mod-side">
          <DocsNav path={path} sections={sections} />
        </div>
        <article className="panel release-note docs-page">
          <h1 className="mod-name">{page.title}</h1>
          <Readme blocks={page.blocks} />
          <nav className="release-around docs-around">
            {[all[at - 1], all[at + 1]].map(
              (around, index) =>
                around && (
                  <Link
                    key={around.slug}
                    className={index === 0 ? "newer" : undefined}
                    to="/docs/$"
                    params={{ _splat: around.slug }}
                  >
                    {around.title} <Arrow />
                  </Link>
                ),
            )}
          </nav>
        </article>
      </main>
    </>
  );
}
