import type { Block, Media, Span } from "../src/mods";

// a mod's README as the game draws it: GitHub's markdown cut down to headings, paragraphs, lists, quotes, code,
// rules and the media it shows. a table is a line per row. the game escapes every text itself: nothing in a span is
// markup to it

/** A block before its media is fetched: a medium is only where it comes from yet. */
export type Draft = Exclude<Block, Media> | { kind: "media"; src: string };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};
// code, bold (two ways), struck (shown plain), italic (two ways), a link and a bare one
const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\s][^*]*?)\*|(?<!\w)_([^_\s][^_]*?)_(?!\w)|\[([^\]]*)\]\(\s*<?([^)\s>]*)>?[^)]*\)|<(https?:[^>\s]+)>/g;
// a markdown image, an html one or a video, or a file dropped into the README on github.com
const MEDIA =
  /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)|<(?:img|video|source)\b[^>]*?\ssrc=["']([^"']+)["'][^>]*>|(https:\/\/github\.com\/user-attachments\/assets\/[\w-]+)/g;
const LINKED_IMAGE = /\[(!\[[^\]]*\]\([^)]*\))\]\([^)]*\)/g; // a badge: its image is what shows

/** Where a link of the README goes, nothing for one the game shouldn't open. */
type Resolve = (href: string) => string | undefined;

function inline(text: string, resolve: Resolve, style: Omit<Span, "text"> = {}): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [all, code, bold, bold2, struck, italic, italic2, link, href, bare] = match;
    spans.push({ ...style, text: text.slice(last, match.index) });
    if (code) spans.push({ ...style, code: true, text: code });
    else if (bold ?? bold2)
      spans.push(...inline((bold ?? bold2)!, resolve, { ...style, bold: true }));
    else if (italic ?? italic2)
      spans.push(...inline((italic ?? italic2)!, resolve, { ...style, italic: true }));
    else if (struck) spans.push(...inline(struck, resolve, style));
    else if (link !== undefined)
      spans.push(...inline(link, resolve, { ...style, link: resolve(href!) }));
    else spans.push({ ...style, link: resolve(bare!), text: bare! });
    last = match.index + all.length;
  }
  spans.push({ ...style, text: text.slice(last) });
  return spans.filter((span) => span.text);
}

// html tags are dropped (a bare link looks like one), entities read
const strip = (text: string) =>
  text
    .replace(/<(?!https?:)[^>]*>/g, "")
    .replace(/&(#?\w+);/g, (all, name: string) => ENTITIES[name] ?? all);

// the spans of a text. code keeps what it says, tags included
const spansOf = (text: string, resolve: Resolve, style?: Omit<Span, "text">) =>
  inline(text.trim(), resolve, style)
    .map((span) => (span.code ? span : { ...span, text: strip(span.text) }))
    .filter((span) => span.text);

/**
 * A README's blocks. Media are kept when `allowed` matches their address, relative ones being under `base`. Links
 * are kept to the web and into the game, relative ones being under `page`.
 */
export function parse(readme: string, base: string, page: string, allowed: RegExp): Draft[] {
  const blocks: Draft[] = [];
  const resolve: Resolve = (href) => {
    const url = URL.canParse(href, page) ? new URL(href, page) : undefined;
    return url && /^(https?|phigrospp):$/.test(url.protocol) ? url.href : undefined;
  };
  // a run of text becomes one block, cut around the media it shows
  const emit = (raw: string, make: (spans: Span[]) => Draft) => {
    const text = raw.replace(LINKED_IMAGE, "$1");
    const push = (part: string) => {
      const spans = spansOf(part, resolve);
      if (spans.length) blocks.push(make(spans));
    };
    let last = 0;
    for (const match of text.matchAll(MEDIA)) {
      push(text.slice(last, match.index));
      const source = match[1] ?? match[2] ?? match[3]!;
      const src = URL.canParse(source, base) && new URL(source, base).href;
      if (src && allowed.test(src)) blocks.push({ kind: "media", src });
      last = match.index + match[0].length;
    }
    push(text.slice(last));
  };
  // the lines of the block being read: a line that starts nothing new goes on with it, as markdown has it
  let run: { lines: string[]; quote?: true; make: (spans: Span[]) => Draft } | undefined;
  const flush = () => {
    if (run) emit(run.lines.join(" "), run.make);
    run = undefined;
  };
  const lines = readme
    .replace(/\r/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```|~~~)/.exec(line);
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const row = /^\s*\|(.+)\|\s*$/.exec(line);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!))
        code.push(lines[i]!);
      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      emit(heading[2]!, (spans) => ({
        kind: "heading",
        level: Math.min(heading[1]!.length, 3),
        spans,
      }));
    } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
    } else if (row) {
      flush();
      // a table's body rows, each "first cell: the others". its header says what the cells are, which the cells show
      const [first, ...rest] = row[1]!.split("|").map((cell) => cell.trim());
      const header = /^[\s|:-]+$/.test(lines[i + 1] ?? "");
      if (!header && !/^[\s|:-]+$/.test(row[1]!))
        blocks.push({
          kind: "text",
          spans: [
            ...spansOf(first!, resolve, { bold: true }),
            ...inline(
              (rest.some(Boolean) ? ": " : "") + rest.filter(Boolean).join(", "),
              resolve,
            ).map((span) => (span.code ? span : { ...span, text: strip(span.text) })),
          ],
        });
    } else if (item) {
      flush();
      const mark = /\d/.test(item[2]!) ? item[2]!.replace(")", ".") : "•";
      const depth = Math.min(item[1]!.length >> 1, 3);
      run = { lines: [item[3]!], make: (spans) => ({ kind: "item", mark, depth, spans }) };
    } else if (/^\s*>/.test(line)) {
      if (!run?.quote) flush();
      run ??= { lines: [], quote: true, make: (spans) => ({ kind: "quote", spans }) };
      run.lines.push(line.replace(/^\s*>\s?/, ""));
    } else {
      run ??= { lines: [], make: (spans) => ({ kind: "text", spans }) };
      run.lines.push(line.trim());
    }
  }
  flush();
  return blocks;
}
