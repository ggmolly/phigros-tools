import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Question } from "../components/question";
import { Rich, useT } from "../i18n";
import { headT, pageLinks, pageMeta } from "../seo";

const INSTALLER = "https://github.com/ggmolly/PhigrosPlusPlus-Installer/releases/latest";
const SOURCE = "https://github.com/ggmolly/PhigrosPlusPlus";
const SIDESTORE = "https://docs.sidestore.io/docs/installation/prerequisites";
const GET_DOCKER = "https://docs.docker.com/get-docker/";
const DEVICES = ["android", "ios"] as const;
// what the ios steps run, the same in every language
const NIX = "sh <(curl -L https://nixos.org/nix/install) --daemon";
const CLONE = `git clone --recursive ${SOURCE}`;
const DOCKER = `docker run -it --rm --platform linux/amd64 -v "$PWD":/work -w /work -v "$HOME/Phigros":/root/Phigros nixos/nix`;
const BUILD = "cd PhigrosPlusPlus\nnix-shell --run 'make ipa IPA=~/Phigros'";

type Part = { text: string; href?: string; command?: string };
// a step, or two ways to do it side by side
type Step = Part | [Part, Part];

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

/** A command to type, with a button putting it in the clipboard. */
function Command({ text }: { text: string }) {
  const p = useT().pppPage;
  const [copied, setCopied] = useState(false);
  return (
    <div className="ppp-command">
      <code>{text}</code>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? p.copied : p.copy}
      </button>
    </div>
  );
}

/** Getting Phigros++ on the player's platform, then their save into it. */
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
        { text: p.ios2 },
        [
          { text: p.ios3, command: NIX },
          { text: p.ios3b, href: GET_DOCKER, command: DOCKER },
        ],
        { text: p.ios4, command: CLONE },
        { text: p.ios5, command: BUILD },
        { text: p.ios6, href: SIDESTORE },
        { text: p.ios7 },
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
                <ol className="ppp-steps">
                  {steps.map((step) => {
                    const parts = Array.isArray(step) ? step : [step];
                    return (
                      <li key={parts[0].text}>
                        <div className={parts.length > 1 ? "ppp-ways" : undefined}>
                          {parts.map(({ text, href, command }) => (
                            <div key={text}>
                              <p>
                                <Rich text={text} href={href} />
                              </p>
                              {command && <Command text={command} />}
                            </div>
                          ))}
                        </div>
                      </li>
                    );
                  })}
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
