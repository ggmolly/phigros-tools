import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import { encode } from "uqr";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { ModMedia } from "../components/mods";
import { Patcher } from "../components/patcher";
import { Question } from "../components/question";
import { Rich, useT } from "../i18n";
import type { Media } from "../mods";
import { getRelease } from "../releases";
import { headT, localeUrl, pageLinks, pageMeta } from "../seo";

const INSTALLER = "https://github.com/ggmolly/PhigrosPlusPlus-Installer/releases/latest";
const SOURCE = "https://github.com/ggmolly/PhigrosPlusPlus";
const SIDESTORE = "https://docs.sidestore.io/docs/installation/prerequisites";
const DEVICES = ["android", "ios"] as const;

// a step's bold words link to its href, and what helps doing it stands under it
type Step = { text: string; href?: string; under?: ReactNode };

/** The address as a QR code, crisp SVG squares dark on a white tile, which scanners need whatever the theme. */
function QrCode({ text }: { text: string }) {
  const { data, size } = encode(text, { border: 2 });
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" aria-hidden="true">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export const Route = createFileRoute("/phigrospp")({
  // the answer is the address, so each platform's steps can be linked
  validateSearch: (search): { device?: (typeof DEVICES)[number] } => ({
    device: DEVICES.find((device) => device === search.device),
  }),
  // the release note that shows the game's Profile settings, where the last step happens
  loader: () => getRelease({ data: "sync-and-profile" }),
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.tabs.phigrospp,
        description: t.pppPage.description,
        path: "/phigrospp",
        locale,
      }),
      links: pageLinks("/phigrospp", locale),
    };
  },
  component: PhigrosppPage,
});

/** Getting Phigros++ on the player's platform, then on to bringing their save into it. */
function PhigrosppPage() {
  const t = useT();
  const p = t.pppPage;
  const { device } = Route.useSearch();
  const { i18n } = Route.useRouteContext();
  const android = device === "android";
  const profile = Route.useLoaderData()?.note.blocks.find(
    (block): block is Media => block.kind === "media" && block.src === "profile.webp",
  );
  const sync: Step = {
    text: p.sync,
    under: profile && <ModMedia {...profile} folder="/releases/" />,
  };
  const steps: Step[] = android
    ? [
        { text: p.install1 },
        {
          text: p.install2,
          href: `${INSTALLER}/download/phigrospp-installer.apk`,
          // the installer runs on the phone: a computer's screen gets this page's address to scan
          under: (
            <p className="ppp-scan meta">
              <QrCode text={`${localeUrl("/phigrospp", i18n.locale)}?device=android`} />
              {p.scan}
            </p>
          ),
        },
        { text: p.install3 },
        { text: p.install4 },
        sync,
      ]
    : [
        { text: p.ios1 },
        { text: p.ios2, under: <Patcher /> },
        { text: p.ios3, href: SIDESTORE },
        { text: p.ios4 },
        sync,
      ];
  // the steps take the focus the answered tile had
  const flow = useRef<HTMLElement>(null);
  const loaded = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the answer is what moves the focus
  useEffect(() => {
    if (loaded.current) flow.current?.querySelector<HTMLElement>("h2")?.focus();
    loaded.current = true;
  }, [device]);
  return (
    <>
      <SiteHeader />
      <main className="app-shell ppp-page">
        <section className="panel" ref={flow}>
          <h1 className="ppp-title">
            Phigros<span>++</span>
          </h1>
          <p className="ppp-lead">
            {p.description}{" "}
            <Link className="text-link" to="/releases">
              {t.releasesPage.title}
            </Link>
          </p>
          <div className="start-flow">
            <Question
              to="/phigrospp"
              title={p.platform}
              answer={device && t.start[device]}
              options={DEVICES.map((option) => ({
                icon: option,
                label: t.start[option],
                search: { device: option },
              }))}
              back={{}}
            />
            {device && (
              <div className="start-question">
                <h2 tabIndex={-1}>{android ? p.install : p.iosTitle}</h2>
                {android && <p className="meta">{p.downloadNote}</p>}
                <ol className="ppp-steps">
                  {steps.map(({ text, href, under }) => (
                    <li key={text}>
                      <p>
                        <Rich text={text} href={href} />
                      </p>
                      {under}
                    </li>
                  ))}
                </ol>
                <div className="start-next">
                  <p className="meta">
                    <Rich text={android ? p.installNote : p.iosNote} />
                    {!android && " "}
                    {!android && <Rich text={p.iosBuild} href={`${SOURCE}/wiki/Development`} />}
                  </p>
                  <div className="ppp-bar-actions">
                    <a
                      className="btn start-go"
                      href={android ? INSTALLER : SOURCE}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {android ? p.download : p.source} <Arrow />
                    </a>
                    <Link to="/start" className="btn btn-ghost start-go">
                      {t.start.cta} <Arrow />
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
