import { createFileRoute, Link } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Rich, useT } from "../i18n";
import { headT, pageLinks, pageMeta } from "../seo";

const INSTALLER = "https://github.com/ggmolly/PhigrosPlusPlus-Installer/releases/latest";
const SOURCE = "https://github.com/ggmolly/PhigrosPlusPlus";

export const Route = createFileRoute("/phigrospp")({
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

// what each feature looks like, drawn small over its text like in the trailer. decorative: the text says it all
const REPLAY = (
  <div className="ppp-visual ppp-replay" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <path d="M6 3.5v17l14-8.5z" />
    </svg>
    <span className="ppp-seek">
      <i />
      <i />
      <i />
      <i />
    </span>
    <b>16×</b>
  </div>
);
const HUD = (
  <div className="ppp-visual ppp-hud" aria-hidden="true">
    <span>0996761</span>
    <span>
      <b>V</b> 99.57%
    </span>
    <span className="ppp-timing">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  </div>
);
const WORDS = (
  <ol className="ppp-visual ppp-words" aria-hidden="true">
    {["pigeon", "geopelia", "gino", "coo", "rhythm", "bpm"].map((word) => (
      <li key={word}>{word}</li>
    ))}
  </ol>
);

function PhigrosppPage() {
  const t = useT();
  const p = t.pppPage;
  return (
    <>
      <SiteHeader />
      <main className="app-shell ppp-page">
        <section className="panel ppp-hero">
          <h1 className="ppp-title">
            Phigros<span>++</span>
          </h1>
          <p className="ppp-lead">{p.description}</p>
          <div className="ppp-download">
            <a className="btn" href={INSTALLER} target="_blank" rel="noopener noreferrer">
              {p.download} <Arrow />
            </a>
            <span className="meta">{p.downloadNote}</span>
            <a className="text-link" href={SOURCE} target="_blank" rel="noopener noreferrer">
              {p.source}
            </a>
          </div>
        </section>
        <div className="ppp-features">
          {(
            [
              [p.replays, p.replaysText, REPLAY],
              [p.hud, p.hudText, HUD],
              [p.sync, p.syncText, WORDS],
            ] as const
          ).map(([title, text, visual]) => (
            <section key={title} className="panel">
              {visual}
              <h2 className="panel-title">{title}</h2>
              <p className="meta">{text}</p>
            </section>
          ))}
        </div>
        <section className="panel">
          <h2 className="panel-title">{p.install}</h2>
          <ol className="guide-steps">
            {[p.install1, p.install2, p.install3, p.install4].map((step) => (
              <li key={step}>
                <Rich text={step} />
              </li>
            ))}
          </ol>
          <p className="meta">{p.installNote}</p>
        </section>
        <section className="panel">
          <h2 className="panel-title">{p.bring}</h2>
          <p className="meta">{p.bringText}</p>
          <div className="ppp-cases">
            {(
              [
                [p.browser, p.browserText],
                [p.device, p.deviceText],
                [p.game, p.gameText],
              ] as const
            ).map(([title, text]) => (
              <div key={title} className="ppp-case">
                <h3>{title}</h3>
                <p className="meta">
                  <Rich text={text} />
                </p>
              </div>
            ))}
          </div>
          <Link to="/" className="btn btn-ghost">
            {t.notFound.openSave} <Arrow />
          </Link>
        </section>
      </main>
    </>
  );
}
