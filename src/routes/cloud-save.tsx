import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Rich, useT } from "../i18n";
import { headT, pageLinks, pageMeta } from "../seo";

export const Route = createFileRoute("/cloud-save")({
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.cloudSave.title,
        description: t.cloudSave.description,
        path: "/cloud-save",
        locale,
      }),
      links: pageLinks("/cloud-save", locale),
    };
  },
  component: CloudSavePage,
});

/** What /start asks, written out for every case at once, for players searching why Sync stopped. */
function CloudSavePage() {
  const t = useT();
  const s = t.start;
  const c = t.cloudSave;
  return (
    <>
      <SiteHeader />
      <main className="app-shell ppp-page">
        <section className="panel start">
          <h1 className="panel-title">{c.title}</h1>
          <div className="start-question">
            <p className="meta">
              <Rich text={c.lost} />
            </p>
            <p className="meta">{c.kept}</p>
          </div>
          <div className="start-next">
            <span />
            <Link to="/start" className="btn start-go">
              {s.cta} <Arrow />
            </Link>
          </div>
        </section>
        <Case
          title={c.rooted}
          steps={[s.root1, s.root2, s.root3, s.root4]}
          note={s.rootFallback}
          to="/phigrospp"
          action={s.install}
        >
          <p className="meta">{s.rootText}</p>
        </Case>
        <Case
          title={s.rebuildTitle}
          steps={[s.rebuild1, s.rebuild2, s.rebuild3]}
          note={s.declared}
          to="/rebuild"
          action={s.rebuild}
        >
          {(["android", "ios", "gone"] as const).map((device) => (
            <p key={device} className="meta">
              <strong>{s[device]}.</strong>{" "}
              <Rich
                text={s[`${device}Text`]}
                href={device === "ios" ? "/phigrospp?device=ios" : undefined}
              />
            </p>
          ))}
        </Case>
        <section className="ppp-cases start-cases">
          <div className="panel">
            <div>
              <h2>{s.other}</h2>
              <p className="meta">
                <Rich text={s.otherText} />
              </p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function Case(props: {
  title: string;
  children: ReactNode;
  steps: string[];
  note: string;
  to: "/phigrospp" | "/rebuild";
  action: string;
}) {
  return (
    <section className="panel start">
      <div className="start-question">
        <h2>{props.title}</h2>
        {props.children}
        <ol className="guide-steps start-steps">
          {props.steps.map((step) => (
            <li key={step}>
              <Rich text={step} />
            </li>
          ))}
        </ol>
        <div className="start-next">
          <p className="meta">{props.note}</p>
          <Link to={props.to} className="btn start-go">
            {props.action} <Arrow />
          </Link>
        </div>
      </div>
    </section>
  );
}
