import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
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

// the answers drawn like the game's icons, a phone or tablet told apart by what its screen shows
const PHONE = "M21 5h22v38H21z";
const BOTH = "M42 10V6H4v28h32M36 10h22v36H36z";
const ICONS = {
  android: `${BOTH}M43 38.75v4.5L39 41zM49.25 41a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0M50.75 38.75h4.5v4.5h-4.5zM46.5 15h1`,
  ios: `${BOTH}M44 15h6M43 43h8M15 31h10`,
  gone: PHONE,
  rooted: `${PHONE}M30 16.5l-1.5 15M36 16.5l-1.5 15M26 21h12.5M25.5 27H38`,
  unrooted: `${PHONE}M26.5 23h11v9.5h-11zM28.5 23v-3.5a3.5 3.5 0 0 1 7 0V23`,
};
type Option = { icon: keyof typeof ICONS; label: string; search: Answers };

/** One question: its answers as tiles, or the one given as a chip leading back to it. */
function Question({
  title,
  answer,
  options,
  back,
}: {
  title: string;
  answer?: string;
  options: Option[];
  back: Answers;
}) {
  const t = useT();
  if (answer)
    return (
      <Link to="/start" search={back} resetScroll={false} className="btn btn-ghost start-answer">
        <span>
          <strong>{answer}</strong>
          <small>{title}</small>
        </span>
        <u>{t.start.change}</u>
      </Link>
    );
  return (
    <div className="start-question">
      <h2 tabIndex={-1}>{title}</h2>
      <div className="start-tiles">
        {options.map(({ icon, label, search }) => (
          <Link key={icon} to="/start" search={search} resetScroll={false} className="start-tile">
            <svg aria-hidden="true" viewBox="0 0 64 48" data-icon={icon}>
              <path d={ICONS[icon]} />
            </svg>
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

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
                <p className="meta">{rooted ? s.rootText : s[`${device}Text`]}</p>
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
