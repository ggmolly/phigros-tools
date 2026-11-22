import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Question } from "../components/question";
import { Rich, useT } from "../i18n";
import { useSave } from "../save-context";
import { headT, pageLinks, pageMeta } from "../seo";

const DEVICES = ["android", "ios", "gone"] as const;
type Answers = { device?: (typeof DEVICES)[number]; root?: boolean };

export const Route = createFileRoute("/start")({
  // the answers are the address, so what a player is told can be linked
  validateSearch: (search): Answers => ({
    device: DEVICES.find((device) => device === search.device),
    root: typeof search.root === "boolean" ? search.root : undefined,
  }),
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.pppPage.bring,
        description: t.start.description,
        path: "/start",
        locale,
      }),
      links: pageLinks("/start", locale),
    };
  },
  component: StartPage,
});

/** Where a player's save is, then what phigros.tools does for it. */
function StartPage() {
  const { snapshots, credentials, openSnapshot } = useSave();
  const t = useT();
  const s = t.start;
  const { device, root } = Route.useSearch();
  // root only changes what an Android device can do: Phigros++ copies the save of Phigros there
  const asksRoot = device === "android";
  const rooted = asksRoot && root;
  const answered = device && (!asksRoot || root !== undefined);
  const kept = snapshots.find(
    (snapshot) =>
      snapshot.rawZip && !credentials.some((c) => c.signer && c.playerId === snapshot.playerId),
  );
  // an answer brings what follows it: the next question or the outcome takes the focus the answered tile had
  const form = useRef<HTMLElement>(null);
  const loaded = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the answers are what moves the focus
  useEffect(() => {
    if (loaded.current) form.current?.querySelector<HTMLElement>("h2")?.focus();
    loaded.current = true;
  }, [device, root]);
  return (
    <>
      <SiteHeader />
      <main className="app-shell ppp-page">
        <section className="panel start" ref={form}>
          <h1 className="panel-title">{t.pppPage.bring}</h1>
          <p className="meta">{s.description}</p>
          <div className="start-flow">
            <Question
              to="/start"
              title={s.device}
              answer={device && s[device]}
              options={DEVICES.map((option) => ({
                icon: option,
                label: s[option],
                search: { device: option },
              }))}
              back={{}}
            />
            {asksRoot && (
              <Question
                to="/start"
                title={s.root}
                answer={root === undefined ? undefined : root ? s.rooted : s.unrooted}
                options={[
                  { icon: "rooted", label: s.rooted, search: { device, root: true } },
                  { icon: "unrooted", label: s.unrooted, search: { device, root: false } },
                ]}
                back={{ device }}
              />
            )}
            {answered && (
              <div className="start-question">
                <h2 tabIndex={-1}>{rooted ? s.rootTitle : s.rebuildTitle}</h2>
                <p className="meta">
                  <Rich
                    text={rooted ? s.rootText : s[`${device}Text`]}
                    href={device === "ios" ? "/phigrospp?device=ios" : undefined}
                  />
                </p>
                <ol className="guide-steps start-steps">
                  {(rooted
                    ? [s.root1, s.root2, s.root3, s.root4]
                    : [s.rebuild1, s.rebuild2, s.rebuild3]
                  ).map((step) => (
                    <li key={step}>
                      <Rich text={step} />
                    </li>
                  ))}
                </ol>
                <div className="start-next">
                  <p className="meta">
                    {rooted ? (
                      <Link
                        to="/start"
                        search={{ device, root: false }}
                        resetScroll={false}
                        className="text-link"
                      >
                        {s.rootFallback}
                      </Link>
                    ) : (
                      s.declared
                    )}
                  </p>
                  <Link to={rooted ? "/phigrospp" : "/rebuild"} className="btn start-go">
                    {rooted ? s.install : s.rebuild} <Arrow />
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className="ppp-cases start-cases">
          {kept && (
            <div className="panel">
              <div>
                <h2>{s.browser}</h2>
                <p className="meta">
                  <Rich text={s.browserText} />
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void openSnapshot(kept)}
              >
                {t.ppp.openSave} <Arrow />
              </button>
            </div>
          )}
          <div className="panel">
            <div>
              <h2>{s.other}</h2>
              <p className="meta">
                <Rich text={s.otherText} />
              </p>
            </div>
            <Link to="/" className="btn btn-ghost">
              {t.ppp.signInTitle} <Arrow />
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
