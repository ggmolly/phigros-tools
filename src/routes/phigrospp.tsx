import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Question } from "../components/question";
import { Rich, useT } from "../i18n";
import { headT, pageLinks, pageMeta } from "../seo";

const INSTALLER = "https://github.com/ggmolly/PhigrosPlusPlus-Installer/releases/latest";
const SOURCE = "https://github.com/ggmolly/PhigrosPlusPlus";
const DEVICES = ["android", "ios"] as const;

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

/** Getting Phigros++ on the player's platform, then their save into it. */
function PhigrosppPage() {
  const t = useT();
  const p = t.pppPage;
  const { device } = Route.useSearch();
  const android = device === "android";
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
          <p className="ppp-lead">{p.description}</p>
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
                <p className="meta">{android ? p.downloadNote : p.iosIntro}</p>
                <ol className="guide-steps start-steps">
                  {(android
                    ? [p.install1, p.install2, p.install3, p.install4]
                    : [p.ios1, p.ios2, p.ios3, p.ios4, p.install4]
                  ).map((step) => (
                    <li key={step}>
                      <Rich
                        text={step}
                        href={
                          step === p.install2
                            ? `${INSTALLER}/download/phigrospp-installer.apk`
                            : undefined
                        }
                      />
                    </li>
                  ))}
                </ol>
                <div className="start-next">
                  <p className="meta">
                    <Rich text={android ? p.installNote : p.iosNote} />
                  </p>
                  <a
                    className="btn start-go"
                    href={android ? INSTALLER : SOURCE}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {android ? p.download : p.source} <Arrow />
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className="ppp-cases start-cases">
          <div className="panel">
            <div>
              <h2>{p.bring}</h2>
              <p className="meta">{p.bringText}</p>
            </div>
            <Link to="/start" className="btn btn-ghost">
              {t.start.cta} <Arrow />
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
