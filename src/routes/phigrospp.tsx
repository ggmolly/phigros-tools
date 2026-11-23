import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Patcher } from "../components/patcher";
import { Question } from "../components/question";
import { Rich, useT } from "../i18n";
import { headT, pageLinks, pageMeta } from "../seo";

const INSTALLER = "https://github.com/ggmolly/PhigrosPlusPlus-Installer/releases/latest";
const SOURCE = "https://github.com/ggmolly/PhigrosPlusPlus";
const SIDESTORE = "https://docs.sidestore.io/docs/installation/prerequisites";
const DEVICES = ["android", "ios"] as const;

// a step's bold words link to its href, and the game's IPA is patched under the one with the patcher
type Step = { text: string; href?: string; patcher?: boolean };

export const Route = createFileRoute("/phigrospp")({
  // the answer is the address, so each platform's steps can be linked
  validateSearch: (search): { device?: (typeof DEVICES)[number] } => ({
    device: DEVICES.find((device) => device === search.device),
  }),
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
  const android = device === "android";
  const steps: Step[] = android
    ? [
        { text: p.install1 },
        { text: p.install2, href: `${INSTALLER}/download/phigrospp-installer.apk` },
        { text: p.install3 },
        { text: p.install4 },
        { text: p.sync },
      ]
    : [
        { text: p.ios1 },
        { text: p.ios2, patcher: true },
        { text: p.ios3, href: SIDESTORE },
        { text: p.ios4 },
        { text: p.sync },
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
                  {steps.map(({ text, href, patcher }) => (
                    <li key={text}>
                      <p>
                        <Rich text={text} href={href} />
                      </p>
                      {patcher && <Patcher />}
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
