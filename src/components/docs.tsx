import { Link, useLoaderData } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Docs } from "../docs";
import type { Span } from "../mods";
import { HeaderLinks } from "./chrome";
import { ReleaseContents } from "./releases";

const SHOWN = 40; // the most names the search lists

/** The names of the API matching a search: those starting with it as typed first, then in any case, then the rest. */
function search(docs: Docs, query: string) {
  const typed = query.trim();
  const q = typed.toLowerCase();
  const rank = (name: string) =>
    name.startsWith(typed) ? 0 : name.toLowerCase().startsWith(q) ? 1 : 2;
  return docs.symbols
    .filter((symbol) => symbol.name.toLowerCase().includes(q))
    .sort((a, b) => rank(a.name) - rank(b.name))
    .slice(0, SHOWN);
}

/** A box to find a function, a value or a type of the API by its name. "/" anywhere on the page goes to it. */
export function DocsSearch({ onPick }: { onPick?: () => void }) {
  const docs = useLoaderData({ from: "/docs" });
  const [query, setQuery] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (event.key !== "/" || (event.target as HTMLElement).closest("input, textarea")) return;
      event.preventDefault();
      box.current!.focus();
    };
    addEventListener("keydown", focus);
    return () => removeEventListener("keydown", focus);
  }, []);
  const titles = new Map(
    docs.groups.flatMap((group) => group.pages.map((page) => [page.slug, page.title])),
  );
  return (
    <div className="docs-search">
      <input
        ref={box}
        className="field"
        type="search"
        placeholder="Search the API"
        aria-label="Search the API"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && (
        <ul className="docs-results">
          {search(docs, query).map((symbol) => (
            <li key={`${symbol.page}#${symbol.anchor}`}>
              <Link
                to="/docs/$"
                params={{ _splat: symbol.page }}
                hash={symbol.anchor}
                onClick={() => {
                  setQuery("");
                  onPick?.();
                }}
              >
                <code>{symbol.name}</code>
                <span>{titles.get(symbol.page)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The docs' own top bar, without the site's tabs: the site's name leads back to it (router.tsx). */
export function DocsHeader() {
  return (
    <header className="topbar">
      <Link className="corner brand" to="/">
        <span className="brand-name">
          phigros<span className="brand-dot">.</span>
          <span className="brand-sub">tools</span>
        </span>
      </Link>
      <HeaderLinks />
    </header>
  );
}

/** Every page of the docs by group, the one read showing its sections, with the search over them. */
export function DocsNav({ path, sections }: { path: string; sections: Span[][] }) {
  const docs = useLoaderData({ from: "/docs" });
  return (
    <nav className="panel docs-nav" aria-label="Docs">
      <Link to="/docs" className="docs-title">
        Phigros++ docs
      </Link>
      <DocsSearch />
      {docs.groups.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <ul>
            {group.pages.map((page) => (
              <li key={page.slug}>
                <Link to="/docs/$" params={{ _splat: page.slug }} activeOptions={{ exact: true }}>
                  {page.title}
                </Link>
                {page.slug === path && sections.length > 1 && (
                  <ReleaseContents sections={sections} label={`${page.title}, its sections`} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
