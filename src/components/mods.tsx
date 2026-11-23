import { Link } from "@tanstack/react-router";
import { type CSSProperties, Fragment, useEffect, useRef } from "react";
import { useFormat, useT } from "../i18n";
import type { Block, Media, Mod, Span } from "../mods";
import { SITE } from "../seo";

const VERIFIED =
  "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Zm12.15.38-5.5 5.5L8 12";
const STAR =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

/** Who made a mod (every listed mod is signed by its author's key of the registry), its release, size and stars. */
export function ModFacts({ mod }: { mod: Mod }) {
  const t = useT();
  const format = useFormat();
  const mega = mod.size >= 1e6;
  return (
    <p className="mod-facts">
      <span>
        <svg
          className="mod-icon mod-verified"
          viewBox="0 0 24 24"
          role="img"
          aria-label={t.modsPage.verified}
        >
          <path d={VERIFIED} />
        </svg>
        {mod.author}
      </span>
      <span>{mod.version}</span>
      <span>
        {format.number(mod.size / (mega ? 1e6 : 1e3), {
          style: "unit",
          unit: mega ? "megabyte" : "kilobyte",
          maximumFractionDigits: 1,
        })}
      </span>
      <span>
        <svg className="mod-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d={STAR} />
        </svg>
        {format.number(mod.stars)}
      </span>
    </p>
  );
}

/**
 * What a mod shows (or a release note, from its own `folder`), cut on the game's slant like a song's cover in its
 * song list. A clip only plays while it's on screen, and not at all for a reader who asked for less motion: they
 * keep its first frame. The one a page opens on is `eager`, the others wait to be scrolled to.
 */
export function ModMedia({
  poster,
  clip,
  width,
  height,
  slanted,
  eager,
  folder = "/catalog/",
}: {
  poster: string;
  clip?: string;
  width: number;
  height: number;
  slanted?: boolean;
  eager?: boolean;
  folder?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting)
        void element.play().catch(() => undefined); // refused while the tab is in the background
      else element.pause();
    });
    seen.observe(element);
    return () => seen.disconnect();
  }, []);
  const shared = {
    className: slanted ? "mod-media slanted" : "mod-media",
    width,
    height,
    // its shape whatever the file's own, and how far the slant leans as a share of the width
    style: {
      aspectRatio: `${width} / ${height}`,
      "--lean": `${(height / width) * 25}%`,
    } as CSSProperties,
  };
  return clip ? (
    <video
      ref={video}
      {...shared}
      src={folder + clip}
      poster={folder + poster}
      muted
      loop
      playsInline
      preload="none"
    />
  ) : (
    <img
      {...shared}
      src={folder + poster}
      alt=""
      loading={eager ? undefined : "lazy"}
      fetchPriority={eager ? "high" : undefined}
    />
  );
}

function Spans({ spans }: { spans: Span[] }) {
  return spans.map((span, index) => {
    let node: React.ReactNode = span.text;
    if (span.code) node = <code>{node}</code>;
    if (span.italic) node = <em>{node}</em>;
    if (span.bold) node = <strong>{node}</strong>;
    // a link to install a mod is that mod's page here
    const repo = span.link && /^phigrospp:\/\/install\/([^/]+)\/([^/]+)$/.exec(span.link);
    if (repo)
      node = (
        <Link
          className="text-link"
          to="/mods/$owner/$name"
          params={{ owner: repo[1]!, name: repo[2]! }}
        >
          {node}
        </Link>
      );
    // a release note links to the site's own pages
    else if (span.link?.startsWith(`${SITE}/`))
      node = (
        <a className="text-link" href={span.link.slice(SITE.length)}>
          {node}
        </a>
      );
    else if (span.link?.startsWith("http"))
      node = (
        <a
          className="text-link"
          href={span.link}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
        >
          {node}
        </a>
      );
    // biome-ignore lint/suspicious/noArrayIndexKey: the spans never reorder.
    return <Fragment key={index}>{node}</Fragment>;
  });
}

const HEADINGS = ["h2", "h2", "h3", "h4"] as const;

/** The id a heading has in its page, for a link to it: its text in lowercase, a dash for what isn't a letter or a digit. */
export const anchorOf = (spans: Span[]) =>
  spans
    .map((span) => span.text)
    .join("")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");

/**
 * A mod's README as the server cut it into blocks (server/readme.ts), like the game draws it, or a release note.
 * Its title and what the page already shows above (`shown`) aren't repeated. Its media are under `folder`.
 */
export function Readme({
  blocks,
  shown,
  folder,
}: {
  blocks: Block[];
  shown?: Media;
  folder?: string;
}) {
  return (
    <div className="readme">
      {blocks.map((block, index) => {
        const key = index; // the blocks never reorder
        if (block.kind === "heading") {
          if (index === 0 && block.level === 1) return null;
          const Heading = HEADINGS[block.level]!;
          return (
            // it takes the focus when a link jumps to it
            <Heading key={key} id={anchorOf(block.spans)} tabIndex={-1}>
              <Spans spans={block.spans} />
            </Heading>
          );
        }
        if (block.kind === "text")
          return (
            <p key={key}>
              <Spans spans={block.spans} />
            </p>
          );
        if (block.kind === "item")
          return (
            <p
              key={key}
              className="readme-item"
              style={{ "--depth": block.depth } as CSSProperties}
            >
              <span aria-hidden="true">{block.mark}</span>
              <span>
                <Spans spans={block.spans} />
              </span>
            </p>
          );
        if (block.kind === "quote")
          return (
            <blockquote key={key}>
              <Spans spans={block.spans} />
            </blockquote>
          );
        if (block.kind === "code") return <pre key={key}>{block.text}</pre>;
        if (block.kind === "rule") return <hr key={key} />;
        if (block.poster === shown?.poster) return null;
        return <ModMedia key={key} {...block} folder={folder} />;
      })}
    </div>
  );
}
