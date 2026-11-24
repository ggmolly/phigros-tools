import { defineHandler, getQuery, HTTPError } from "nitro/h3";
import type { Doc, Docs } from "../../../src/docs";
import built from "../../../src/docs.json";

// the docs (scripts/build-docs.ts): their groups and names, or ?page=<path> the page at that path
const { pages, ...docs } = built as Docs & { pages: Record<string, Doc> };

export default defineHandler((event) => {
  const { page } = getQuery(event);
  if (page === undefined) return docs;
  const found = pages[String(page)];
  if (!found) throw HTTPError.status(404);
  return found;
});
