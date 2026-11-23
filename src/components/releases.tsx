import { useLoaderData } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useFormat } from "../i18n";
import type { Span } from "../mods";
import { releaseTag } from "../release";
import type { Release } from "../releases";
import { anchorOf } from "./mods";

/**
 * What a release note is of and when: the version of Phigros++ it came with, in gold while it's the latest one, or
 * the site, then its day.
 */
export function ReleaseFacts({ release }: { release: Release }) {
  const format = useFormat();
  const { phigrospp: latest } = useLoaderData({ from: "__root__" });
  const kind = !release.phigrospp
    ? ""
    : release.phigrospp === latest
      ? " status-latest"
      : " status-verified";
  return (
    <p className="mod-facts">
      <span className={`status${kind}`}>{releaseTag(release)}</span>
      <time dateTime={release.date}>
        {format.date(release.date, { dateStyle: "long", timeZone: "UTC" })}
      </time>
    </p>
  );
}

const READ = 0.4; // how far down the window a heading starts the section being read

/**
 * A note's sections, each a link to where it's read. The one being read is marked: the last whose heading came up
 * past the window's upper part, or the last of all at the page's end, which a short one never comes up to.
 */
export function ReleaseContents({ sections, label }: { sections: Span[][]; label: string }) {
  const ids = sections.map(anchorOf);
  const [read, setRead] = useState(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ids only change with the note
  useEffect(() => {
    const follow = () => {
      const end = scrollY > 0 && innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      const passed = ids.findLastIndex(
        (id) => document.getElementById(id)!.getBoundingClientRect().top <= innerHeight * READ,
      );
      setRead(end ? ids.length - 1 : passed);
    };
    follow();
    addEventListener("scroll", follow, { passive: true });
    return () => removeEventListener("scroll", follow);
  }, [ids.join()]);
  return (
    <nav className="release-toc" aria-label={label}>
      <ul>
        {sections.map((spans, index) => (
          <li key={ids[index]}>
            <a href={`#${ids[index]}`} aria-current={index === read || undefined}>
              {spans.map((span) => span.text).join("")}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
