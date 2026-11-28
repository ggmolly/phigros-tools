import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as v from "valibot";
import { type Asked, getAdmin } from "../admin";
import { catalogSong } from "../catalog";
import { SiteHeader } from "../components/chrome";
import { Bars, Heat, Shares } from "../components/plots";
import { Stat } from "../components/primitives";
import { LinePlot } from "../components/rks-history";
import { useFormat } from "../i18n";
import { MODS } from "../modifiers";
import styles from "../styles/admin.css?url";

/*
 * What the admins see of the site (server/admin.ts): the pages seen, who plays and what they play, the requests and
 * how they went, the errors of the server and of the pages, the logs to search, what the server holds right now, and
 * the tools to look a player or a replay up. It's in English only: the languages' messages are sent to every visitor,
 * and this page has a handful of readers.
 */

const TABS = ["traffic", "players", "game", "requests", "errors", "logs", "live", "tools"] as const;
const RANGES = ["1h", "24h", "7d", "30d"] as const;
// how wide a point of the requests' line is, for each range
const STEP = { "1h": "1m", "24h": "15m", "7d": "2h", "30d": "8h" };
const DAYS = [7, 30, 90] as const;

export const Route = createFileRoute("/admin")({
  validateSearch: v.object({
    tab: v.optional(v.picklist(TABS)),
    range: v.optional(v.picklist(RANGES)),
    days: v.optional(v.picklist(DAYS)),
    q: v.optional(v.string()),
    // the player and the replay the tools look up
    find: v.optional(v.string()),
    replay: v.optional(v.string()),
  }),
  loader: async () => {
    const state = await getAdmin();
    if (!state) throw notFound();
    return state;
  },
  head: () => ({
    meta: [{ title: "Admin" }, { name: "robots", content: "noindex" }],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: Admin,
});

type Line = Record<string, string>;
type Loaded<T> = { data?: T; error?: string };

const json = (response: Response) => response.json();
// VictoriaLogs answers a query with one JSON object per line
const lines = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Line);

// what a path of the admin API answers, asked again when it changes and every `again` ms
function useAsked<T>(path: string, read: (response: Response) => Promise<T>, again = 0) {
  const [loaded, setLoaded] = useState<Loaded<T>>({});
  useEffect(() => {
    let shown = true;
    const ask = async () => {
      const response = await fetch(path);
      if (!response.ok)
        throw new Error((await response.text()).slice(0, 300) || response.statusText);
      return read(response);
    };
    const load = () =>
      ask().then(
        (data) => shown && setLoaded({ data }),
        (error: Error) => shown && setLoaded({ error: error.message }),
      );
    void load();
    const timer = again ? setInterval(load, again) : undefined;
    return () => {
      shown = false;
      clearInterval(timer);
    };
  }, [path, read, again]);
  return loaded;
}

// what the server answers a name of its admin API (ASKED in server/admin.ts)
const useAdmin = <What extends keyof Asked>(what: What, query = "", again = 0) =>
  useAsked<Asked[What]>(`/api/admin/${what}${query && `?${query}`}`, json, again);

const useLogs = (query: string, limit = 1000) =>
  useAsked(`/api/admin/logs/query?${new URLSearchParams({ query, limit: String(limit) })}`, lines);

function Failed({ error }: { error?: string }) {
  return error ? <p className="warning">{error}</p> : null;
}

function Table({ head, rows }: { head: string[]; rows: (React.ReactNode[] | undefined)[] }) {
  return (
    <div className="chart-stats-scroll">
      <table className="song-diff-table">
        <thead>
          <tr>
            {head.map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(
            (row, at) =>
              row && (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are replaced whole
                <tr key={at}>
                  {row.map((cell, column) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns never reorder
                    <td key={column} className={typeof cell === "number" ? "num" : undefined}>
                      {typeof cell === "number" ? cell.toLocaleString("en") : cell}
                    </td>
                  ))}
                </tr>
              ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Choice<T extends string | number>({
  options,
  chosen,
  name,
}: {
  options: readonly T[];
  chosen: T;
  name: "range" | "days";
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: like ScopeSwitch, a fieldset would need a style reset
    <div className="seg" role="group" aria-label={name}>
      {options.map((option) => (
        <Link
          key={option}
          to="/admin"
          search={(search) => ({ ...search, [name]: option })}
          className="seg-option"
          aria-pressed={option === chosen}
        >
          {option}
        </Link>
      ))}
    </div>
  );
}

const when = (time: string | number) =>
  time ? new Date(time).toLocaleString("en-GB", { hour12: false }) : "never";
const searching = (q: string) => ({ tab: "logs" as const, q });
const percent = (part: number, whole: number) =>
  `${Math.round((100 * part) / Math.max(1, whole))}%`;
const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
const tag = (player: { name: string; number: number }) =>
  `${player.name}#${String(player.number).padStart(4, "0")}`;
// a count of each of the last days reads its day, then what the tip adds
const dated = (day: string) =>
  new Date(day).toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });

function Panel({
  title,
  side,
  children,
}: {
  title: string;
  side?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {side}
      </div>
      {children}
    </section>
  );
}

function Stats({ stats }: { stats: [string, React.ReactNode][] }) {
  return (
    <div className="stat-bar">
      <div className="stat-row admin-stats">
        {stats.map(([label, value]) => (
          <Stat key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}

/** A field that puts what's typed in the address under `name`, so what it finds can be linked. */
function Ask({
  name,
  value,
  label,
  placeholder,
}: {
  name: "q" | "find" | "replay";
  value: string;
  label: string;
  placeholder: string;
}) {
  const navigate = Route.useNavigate();
  return (
    <form
      className="admin-search"
      onSubmit={(event) => {
        event.preventDefault();
        const typed = String(new FormData(event.currentTarget).get(name)).trim();
        void navigate({ search: (search) => ({ ...search, [name]: typed || undefined }) });
      }}
    >
      <input
        key={value}
        className="field"
        name={name}
        defaultValue={value}
        aria-label={label}
        placeholder={placeholder}
      />
      <button type="submit" className="btn">
        Search
      </button>
    </form>
  );
}

const Player = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <Link to="/admin" search={{ tab: "tools", find: id }}>
    {children}
  </Link>
);

function TrafficTab() {
  const { days = 30 } = Route.useSearch();
  const format = useFormat();
  const { data, error } = useAdmin("traffic", `days=${days}`);
  const sum = (field: "views" | "visitors" | "bot_views") =>
    data?.days.reduce((total, day) => total + day[field], 0) ?? 0;
  const named = (top: Asked["traffic"]["pages"] = []) =>
    top.map((row) => [
      <span key="name" title={row.name}>
        {row.name || "none"}
      </span>,
      row.views,
      row.visitors,
    ]);
  const VIEWS = ["", "Views", "Visitors"];
  const tops: [string, string[], React.ReactNode[][]][] = [
    ["Pages", VIEWS, named(data?.pages)],
    [
      "Entry Pages",
      ["", "Visits", "Left after it"],
      (data?.entries ?? []).map((row) => [row.name, row.visits, percent(row.alone, row.visits)]),
    ],
    [
      "After the Home Page",
      ["", "Views"],
      (data?.after ?? []).map((row) => [row.name || "left the site", row.views]),
    ],
    ["Referrers", VIEWS, named(data?.referrers)],
    ["Countries", VIEWS, named(data?.countries)],
    ["Browsers", VIEWS, named(data?.browsers)],
    ["Devices", VIEWS, named(data?.devices)],
    ["Bots", VIEWS, named(data?.bots)],
  ];
  // the server counts a week from sunday, the page shows it from monday
  const seenAt = (weekday: number, hour: number) =>
    data?.hours.find((cell) => cell.dow === (weekday + 1) % 7 && cell.hour === hour)?.views ?? 0;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Visitors</h2>
          <Choice options={DAYS} chosen={days} name="days" />
        </div>
        <Failed error={error} />
        {data && (
          <>
            <div className="stat-bar">
              <div className="stat-row">
                <Stat label="Visitors, a day each" value={sum("visitors")} />
                <Stat label="Pages seen" value={sum("views")} />
                <Stat label="Seen by bots" value={sum("bot_views")} />
              </div>
            </div>
            <LinePlot
              values={data.days.map((day) => day.visitors)}
              low={0}
              high={Math.max(1, ...data.days.map((day) => day.visitors))}
              label={`Visitors a day over ${days} days`}
              tip={(at) => (
                <>
                  <span className="meta">
                    {format.date(data.days[at]!.day, { month: "short", day: "numeric" })}
                  </span>
                  <span>{data.days[at]!.visitors} visitors</span>
                  <span>{data.days[at]!.views} pages</span>
                </>
              )}
            />
          </>
        )}
      </section>
      <section className="panel">
        <h2 className="panel-title">On the Way to Phigros++</h2>
        <Table
          head={["", "Views", "Visitors"]}
          rows={[
            ...(data?.way ?? []).map((row) => [row.name, row.views, row.visitors]),
            data && ["Profiles made", "", data.profiles],
            data?.downloads != null && ["Installer downloads, all time", "", data.downloads],
          ].map((row) => row || undefined)}
        />
      </section>
      <Panel title="Pages Seen by Hour, UTC">
        <Heat count={seenAt} unit="pages" />
      </Panel>
      <div className="admin-tops">
        {tops.map(([title, head, rows]) => (
          <Panel title={title} key={title}>
            <Table head={head} rows={rows} />
          </Panel>
        ))}
        <Panel title="Pages a Visit">
          <Shares
            rows={(data?.depth ?? []).map((row) => [
              row.pages < 10 ? row.pages : "10 and more",
              row.visits,
            ])}
          />
        </Panel>
      </div>
    </>
  );
}

function PlayersTab() {
  const { days = 30 } = Route.useSearch();
  const { data, error } = useAdmin("players", `days=${days}`);
  if (!data) return <Failed error={error} />;
  const { totals, after } = data;
  return (
    <>
      <Panel title="Players" side={<Choice options={DAYS} chosen={days} name="days" />}>
        <Stats
          stats={[
            ["Registered", totals.registered],
            ["Seen in a day", totals.day],
            ["Seen in a week", totals.week],
            ["Seen in a month", totals.month],
            ["Devices signed in", totals.devices],
            ["Friendships", totals.friendships],
            ["Requests waiting", totals.asked],
            ["Unlisted", totals.unlisted],
          ]}
        />
      </Panel>
      <Panel title="Profiles Made a Day">
        <Bars
          values={data.made.map((day) => day.n)}
          label={`Profiles made a day over ${days} days`}
          ends={[dated(data.made[0]!.day), dated(data.made.at(-1)!.day)]}
          tip={(at) => (
            <>
              <span className="meta">{dated(data.made[at]!.day)}</span>
              <span>{data.made[at]!.n} made</span>
            </>
          )}
        />
      </Panel>
      <Panel title="Players Who Played a Day">
        <Bars
          values={data.active.map((day) => day.n)}
          label={`Players who played a day over ${days} days`}
          ends={[dated(data.active[0]!.day), dated(data.active.at(-1)!.day)]}
          tip={(at) => (
            <>
              <span className="meta">{dated(data.active[at]!.day)}</span>
              <span>{data.active[at]!.n} played</span>
            </>
          )}
        />
      </Panel>
      <div className="admin-tops">
        <Panel title="After Making a Profile">
          <Shares
            rows={[
              ["Made a profile", after.made],
              ["Uploaded a save", after.saved],
              ["Signed in a device", after.joined],
              ["Played a song", after.played],
              ["Played on another day", after.again],
            ]}
          />
          <p className="meta">
            {after.kept} of the {after.old} profiles made a week ago or more played a week after
            they were made.
          </p>
        </Panel>
        <Panel title="Players by RKS">
          <Shares rows={data.rks.map((row) => [`${row.rks} to ${row.rks + 1}`, row.n])} />
        </Panel>
      </div>
      <Panel title="Last Seen">
        <Table
          head={["Player", "RKS", "Made", "Seen", "Devices", "Plays", "Replays", ""]}
          rows={data.list.map((player) => [
            <Player key="player" id={player.id}>
              {tag(player)}
            </Player>,
            player.rks.toFixed(2),
            when(player.created),
            when(player.seen),
            player.devices,
            player.plays,
            player.replays,
            player.unlisted && "unlisted",
          ])}
        />
      </Panel>
    </>
  );
}

const chartName = (song: string, level: string) => `${catalogSong(song)?.title ?? song} ${level}`;

function GameTab() {
  const { days = 30 } = Route.useSearch();
  const { data, error } = useAdmin("game", `days=${days}`);
  if (!data) return <Failed error={error} />;
  const { totals } = data;
  const count = (rows: { name: string; n: number }[], name: string) =>
    rows.find((row) => row.name === name)?.n ?? 0;
  const sent = data.statuses.reduce((sum, row) => sum + row.n, 0);
  return (
    <>
      <Panel title="Songs Played" side={<Choice options={DAYS} chosen={days} name="days" />}>
        <Stats
          stats={[
            ["Songs played", totals.plays],
            ["Hours played", Math.round(totals.hours)],
            ["Notes hit", totals.notes],
            ["Average accuracy", `${totals.accuracy.toFixed(2)}%`],
            ["Replays sent", sent],
            ["Verified", percent(count(data.statuses, "verified"), sent)],
            ["Matches", totals.matches],
            ["Players a match", (totals.seats / Math.max(1, totals.matches)).toFixed(1)],
          ]}
        />
        <Bars
          values={data.days.map((day) => day.plays)}
          label={`Songs played a day over ${days} days`}
          ends={[dated(data.days[0]!.day), dated(data.days.at(-1)!.day)]}
          tip={(at) => (
            <>
              <span className="meta">{dated(data.days[at]!.day)}</span>
              <span>{data.days[at]!.plays} songs</span>
              <span>{data.days[at]!.players} players</span>
              <span>{data.days[at]!.hours.toFixed(1)} hours</span>
            </>
          )}
        />
      </Panel>
      <Panel title="Replays Sent a Day">
        <Bars
          values={data.replays.map((day) => day.n)}
          label={`Replays sent a day over ${days} days`}
          ends={[dated(data.replays[0]!.day), dated(data.replays.at(-1)!.day)]}
          tip={(at) => (
            <>
              <span className="meta">{dated(data.replays[at]!.day)}</span>
              <span>{data.replays[at]!.n} sent</span>
              <span>{data.replays[at]!.verified} verified</span>
            </>
          )}
        />
      </Panel>
      <div className="admin-tops">
        <Panel title="Levels">
          <Shares rows={data.levels.map((row) => [row.name, row.n])} />
        </Panel>
        <Panel title="Modifiers">
          <Shares
            rows={[
              ["None", count(data.mods, "0")],
              ...MODS.map(([bit, , name]): [string, number] => [
                name,
                data.mods.reduce((sum, row) => sum + (Number(row.name) & bit ? row.n : 0), 0),
              ]),
            ]}
          />
        </Panel>
        <Panel title="Accuracy">
          <Shares
            rows={data.accuracy.map((row) => [
              row.accuracy < 90 ? "Under 90%" : row.accuracy < 100 ? `${row.accuracy}%` : "100%",
              row.n,
            ])}
          />
        </Panel>
        <Panel title="Replays">
          <Shares rows={data.statuses.map((row) => [row.name, row.n])} />
        </Panel>
        <Panel title="Game Versions of Replays">
          <Shares rows={data.games.map((row) => [row.name, row.n])} />
        </Panel>
      </div>
      <Panel title="Most Played Charts">
        <Table
          head={["Chart", "Plays", "Players"]}
          rows={data.charts.map((row) => [
            <Link key="chart" to="/charts/$id" params={{ id: row.song }}>
              {chartName(row.song, row.level)}
            </Link>,
            row.plays,
            row.players,
          ])}
        />
      </Panel>
      <Panel title="Last Unverified Replays">
        <Table
          head={["Sent", "Player", "Chart", "Score", ""]}
          rows={data.unverified.map((row) => [
            when(row.created),
            <Player key="player" id={row.player}>
              {row.player}
            </Player>,
            chartName(row.song, row.level),
            row.score,
            <Link key="replay" to="/admin" search={{ tab: "tools", replay: row.sha256 }}>
              Look up
            </Link>,
          ])}
        />
      </Panel>
    </>
  );
}

/** The requests by what a field of theirs says, the most asked first, each leading to its lines. */
function Split({ field, asked }: { field: string; asked: string }) {
  const { data = [], error } = useLogs(
    `${asked} ${field}:* | stats by (${field}) count() as n, count() if (status:>=400) as refused | sort by (n) desc | limit 15`,
  );
  return (
    <Panel title={`By ${field[0]!.toUpperCase()}${field.slice(1)}`}>
      <Failed error={error} />
      <Table
        head={["", "Requests", "Refused"]}
        rows={data.map((row) => [
          <Link key="name" to="/admin" search={searching(`_msg:=http ${field}:="${row[field]}"`)}>
            {row[field]}
          </Link>,
          Number(row.n),
          Number(row.refused),
        ])}
      />
    </Panel>
  );
}

function RequestsTab() {
  const { range = "24h" } = Route.useSearch();
  const asked = `_time:${range} _msg:=http`;
  const failed = "count() if (status:>=500) as errors";
  const rate = useLogs(
    `${asked} | stats by (_time:${STEP[range]}) count() as n, ${failed}, count() if (status:>=400 status:<500) as refused, quantile(0.95, ms) as p95 | sort by (_time)`,
  );
  const slow = useLogs(`${asked} | sort by (ms desc) limit 20`);
  const routes = useLogs(
    `${asked} | stats by (route) count() as n, ${failed}, quantile(0.5, ms) as p50, quantile(0.95, ms) as p95, quantile(0.99, ms) as p99 | sort by (n) desc | limit 60`,
  );
  const points = rate.data ?? [];
  return (
    <>
      <Panel title="Requests" side={<Choice options={RANGES} chosen={range} name="range" />}>
        <Failed error={rate.error ?? routes.error} />
        {points.length > 0 && (
          <LinePlot
            values={points.map((point) => Number(point.n))}
            low={0}
            high={Math.max(1, ...points.map((point) => Number(point.n)))}
            label={`Requests over ${range}`}
            tip={(at) => (
              <>
                <span className="meta">{when(points[at]!._time!)}</span>
                <span>{points[at]!.n} requests</span>
                <span>{points[at]!.refused} refused</span>
                <span>{points[at]!.errors} failed</span>
              </>
            )}
          />
        )}
      </Panel>
      {points.length > 0 && (
        <Panel title="How Long 95% of Them Took">
          <LinePlot
            values={points.map((point) => Number(point.p95))}
            low={0}
            high={Math.max(1, ...points.map((point) => Number(point.p95)))}
            label={`The 95th percentile of the requests' time over ${range}`}
            tip={(at) => (
              <>
                <span className="meta">{when(points[at]!._time!)}</span>
                <span>{Math.round(Number(points[at]!.p95))} ms</span>
              </>
            )}
          />
        </Panel>
      )}
      <div className="admin-tops">
        {["status", "client", "country", "player"].map((field) => (
          <Split key={field} field={field} asked={asked} />
        ))}
      </div>
      <Panel title="Most Asked Routes">
        <Table
          head={["Route", "Requests", "Failed", "p50 ms", "p95 ms", "p99 ms"]}
          rows={(routes.data ?? []).map((row) => [
            <Link key="route" to="/admin" search={searching(`_msg:=http route:="${row.route}"`)}>
              {row.route}
            </Link>,
            Number(row.n),
            Number(row.errors),
            Math.round(Number(row.p50)),
            Math.round(Number(row.p95)),
            Math.round(Number(row.p99)),
          ])}
        />
      </Panel>
      <Panel title="Slowest">
        <Failed error={slow.error} />
        <Table
          head={["When", "Route", "Status", "ms", "Player"]}
          rows={(slow.data ?? []).map((row) => [
            <Link key="when" to="/admin" search={searching(`rid:=${row.rid}`)}>
              {when(row._time!)}
            </Link>,
            row.route,
            row.status,
            Number(row.ms),
            row.player,
          ])}
        />
      </Panel>
    </>
  );
}

function ErrorsTab() {
  const { range = "24h" } = Route.useSearch();
  const grouped = "count() as n, max(_time) as last | sort by (n) desc | limit 100";
  const server = useLogs(`_time:${range} level:=error | stats by (_msg, error, route) ${grouped}`);
  const pages = useLogs(
    `_time:${range} _msg:="client.error" | stats by (message, path, build) ${grouped}`,
  );
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Server Errors</h2>
          <Choice options={RANGES} chosen={range} name="range" />
        </div>
        <Failed error={server.error} />
        <Table
          head={["Event", "Error", "Route", "Times", "Last"]}
          rows={(server.data ?? []).map((row) => [
            row._msg,
            <Link
              key="error"
              to="/admin"
              search={searching(`level:=error _msg:="${row._msg}" error:="${row.error ?? ""}"`)}
            >
              {row.error || "no message"}
            </Link>,
            row.route,
            Number(row.n),
            when(row.last!),
          ])}
        />
      </section>
      <section className="panel">
        <h2 className="panel-title">Page Errors</h2>
        <Failed error={pages.error} />
        <Table
          head={["Message", "Page", "Build", "Times", "Last"]}
          rows={(pages.data ?? []).map((row) => [
            <Link
              key="message"
              to="/admin"
              search={searching(`_msg:="client.error" message:="${row.message}"`)}
            >
              {row.message}
            </Link>,
            row.path,
            row.build,
            Number(row.n),
            when(row.last!),
          ])}
        />
      </section>
    </>
  );
}

const SHORTCUTS = [
  ["Errors", "level:=error"],
  ["Warnings", "level:=warn"],
  ["Requests", "_msg:=http"],
  ["Page errors", '_msg:="client.error"'],
  ["Rooms", "_msg:room.*"],
  ["Replays", "_msg:replay.*"],
] as const;
// what a line shows closed, the rest opens with it
const SHOWN = ["route", "status", "ms", "code", "error", "message", "room", "song", "table"];

function LogsTab() {
  const { range = "24h", q = "" } = Route.useSearch();
  const { data, error } = useLogs(`_time:${range} ${q || "*"} | sort by (_time) desc`, 200);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Logs</h2>
        <Choice options={RANGES} chosen={range} name="range" />
      </div>
      <Ask
        name="q"
        value={q}
        label="LogsQL query"
        placeholder="player:=275be6d045c7, rid:=…, _msg:=http status:>=500"
      />
      <p className="admin-shortcuts">
        {SHORTCUTS.map(([name, query]) => (
          <Link key={name} to="/admin" search={searching(query)}>
            {name}
          </Link>
        ))}
      </p>
      <Failed error={error} />
      {data?.map((line) => (
        <details
          key={`${line._time}${line.rid ?? line._msg}${line.error ?? ""}`}
          className="admin-line"
        >
          <summary>
            <span className="meta">{when(line._time!)}</span>
            <b className={`admin-level admin-${line.level}`}>{line._msg}</b>
            {line.player && (
              <Link to="/admin" search={searching(`player:=${line.player}`)}>
                {line.player}
              </Link>
            )}
            {SHOWN.map((field) => line[field] && <span key={field}>{line[field]}</span>)}
          </summary>
          <pre>{JSON.stringify(line, null, 2).replaceAll("\\n", "\n")}</pre>
        </details>
      ))}
      {data?.length === 0 && <p className="meta">No line matches.</p>}
    </section>
  );
}

function LiveTab({ first }: { first: Asked["state"] }) {
  const { data = first, error } = useAdmin("state", "", 5000);
  const kept = useAdmin("storage");
  const hours = (data.uptime / 3600).toFixed(1);
  const groups: [string, [string, React.ReactNode][]][] = [
    [
      "Now",
      [
        ["Rooms open", data.rooms.rooms],
        ["Players seated", data.rooms.seated],
        ["Browsers watching", data.rooms.watching],
        ["Games connected", data.friends.sockets],
        ["Players online", data.friends.online],
        ["Topics followed", data.live.topics],
      ],
    ],
    [
      "Players",
      [
        ["Registered", data.players.all],
        ["Seen in a day", data.players.day],
        ["Seen in a week", data.players.week],
        ["Matches kept", data.matches],
        ["Replays verified", data.replays.verified ?? 0],
        ["Replays pending", data.replays.pending ?? 0],
      ],
    ],
    [
      "Server",
      [
        ["Hours up", hours],
        ["MB of memory", Math.round(data.memory / 1_048_576)],
        ["Log lines waiting", data.log.waiting],
        ["Log lines dropped", data.log.dropped],
      ],
    ],
  ];
  return (
    <>
      <Failed error={error} />
      {groups.map(([title, stats]) => (
        <Panel
          title={title}
          key={title}
          side={title === "Server" && <span className="panel-count">build {data.build}</span>}
        >
          <Stats stats={stats} />
        </Panel>
      ))}
      <Panel title="Rooms Open">
        <Table
          head={["Room", "Players", "Chart", ""]}
          rows={data.open.map((room) => [
            <Link key="room" to="/rooms/$id" params={{ id: room.id }}>
              {room.name}
            </Link>,
            room.players,
            room.chart && chartName(room.chart.song, room.chart.level),
            [room.playing && "playing", room.locked && "locked"].filter(Boolean).join(", "),
          ])}
        />
        {data.open.length === 0 && <p className="meta">No room is open.</p>}
      </Panel>
      <Failed error={kept.error} />
      {kept.data && (
        <>
          <Panel title="Kept">
            <Stats
              stats={[
                ["Free on the disk", size(kept.data.disk.free)],
                ["Of a disk of", size(kept.data.disk.size)],
                [
                  "In the database",
                  size(kept.data.tables.reduce((sum, table) => sum + table.bytes, 0)),
                ],
                ...kept.data.folders.map(({ name, bytes, files }): [string, string] => [
                  `${files.toLocaleString("en")} files in ${name.slice(7)}`,
                  size(bytes),
                ]),
                ...(kept.data.queues ?? []).map(({ name, waiting }): [string, number] => [
                  `Waiting in ${name}`,
                  waiting,
                ]),
              ]}
            />
          </Panel>
          <Panel title="Tables">
            <Shares
              rows={kept.data.tables.map((table) => [
                table.name,
                table.bytes,
                `${size(table.bytes)}, about ${table.rows.toLocaleString("en")} rows`,
              ])}
            />
          </Panel>
        </>
      )}
    </>
  );
}

/** A button asking the server to do something (DONE in server/admin.ts), which then says how it went. */
function Act({ what, text = "", children }: { what: string; text?: string; children: string }) {
  const [said, setSaid] = useState("");
  const act = () =>
    fetch(`/api/admin/${what}`, { method: "POST", body: text }).then(
      (response) => setSaid(response.ok ? "Asked" : `Refused with ${response.status}`),
      (error: Error) => setSaid(error.message),
    );
  return (
    <p className="admin-act">
      <button type="button" className="btn" onClick={() => void act()}>
        {children}
      </button>
      <span role="status" className="meta">
        {said}
      </span>
    </p>
  );
}

function FoundPlayers({ typed }: { typed: string }) {
  const { data, error } = useAdmin("player", `q=${encodeURIComponent(typed)}`);
  return (
    <>
      <Failed error={error} />
      {data?.length === 0 && <p className="meta">No player has this name or id.</p>}
      {data?.map((player) => (
        <div key={player.id} className="admin-found">
          <h3>
            {tag(player)} {player.roles.join(" ")} {player.unlisted && "unlisted"}
          </h3>
          <p className="admin-shortcuts">
            <Link to="/players/$id" params={{ id: player.id }}>
              Page
            </Link>
            <Link to="/admin" search={searching(`player:=${player.id}`)}>
              Logs
            </Link>
            <span>id {player.id}</span>
            <span>key {player.key}</span>
          </p>
          <Stats
            stats={[
              ["RKS", player.rks.toFixed(2)],
              ["Verified RKS", player.rks_verified.toFixed(2)],
              ["Songs played", player.counts.plays],
              ["Replays verified", player.counts.verified],
              ["Unverified", player.counts.unverified],
              ["Pending", player.counts.pending],
              ["Friends asked", player.counts.friends],
              ["Save", player.save ? size(player.save.size) : "none"],
            ]}
          />
          <Table
            head={["", "When"]}
            rows={[
              ["Made", when(player.created)],
              ["Seen", when(player.seen)],
              player.save && ["Save uploaded", when(player.save.updated)],
              ...player.devices.map((device) => [
                `Device ${device.name}${device.removed ? ", removed" : ""}`,
                when(device.added),
              ]),
            ].map((row) => row || undefined)}
          />
        </div>
      ))}
    </>
  );
}

function FoundReplay({ typed }: { typed: string }) {
  const { data, error } = useAdmin("replay", `q=${encodeURIComponent(typed)}`);
  if (error) return <Failed error={error} />;
  if (data === undefined) return null;
  if (!data) return <p className="meta">No replay has this sha256.</p>;
  return (
    <div className="admin-found">
      <h3>
        {chartName(data.song, data.level)}, {data.status}
      </h3>
      <p className="admin-shortcuts">
        <Link to="/replays/$id" params={{ id: data.sha256 }}>
          Watch
        </Link>
        <Player id={data.player}>Player {data.player}</Player>
        <Link to="/admin" search={searching(`sha256:=${data.sha256}`)}>
          Logs
        </Link>
        <span>sent {when(data.created)}</span>
      </p>
      <Stats
        stats={[
          ["Score", data.score],
          ["Game version", String(data.game)],
          ["Modifiers", data.mods],
          ["Timing", data.timing?.toFixed(2) ?? "none"],
        ]}
      />
      {data.result && <pre>{JSON.stringify(data.result, null, 2)}</pre>}
      {data.status === "unverified" && (
        <Act what="judge" text={data.sha256}>
          Judge it again
        </Act>
      )}
    </div>
  );
}

/** A time as the database keeps it (ms) and as the logs write it, each from the other. */
function Times() {
  const [typed, setTyped] = useState("");
  const time = /^\d+$/.test(typed.trim()) ? Number(typed) : Date.parse(typed);
  return (
    <>
      <input
        className="field admin-time"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        aria-label="A time in ms or as a date"
        placeholder="1795469207808 or 2026-11-28T10:00Z"
      />
      {!Number.isNaN(time) && typed && (
        <p className="admin-shortcuts">
          <span>{time} ms</span>
          <span>{new Date(time).toISOString()}</span>
          <span>{when(time)} here</span>
        </p>
      )}
    </>
  );
}

function ToolsTab() {
  const { find = "", replay = "" } = Route.useSearch();
  return (
    <>
      <Panel title="Find a Player">
        <Ask name="find" value={find} label="Player" placeholder="Name, Name#0042 or id" />
        {find && <FoundPlayers typed={find} />}
      </Panel>
      <Panel title="Find a Replay">
        <Ask
          name="replay"
          value={replay}
          label="Replay"
          placeholder="sha256 or its page’s address"
        />
        {replay && <FoundReplay typed={replay} />}
      </Panel>
      <Panel title="Mod Catalog">
        <p className="meta">
          The worker reads every listed mod’s repository again, as it does each quarter of an hour.
        </p>
        <Act what="catalog">Read it again now</Act>
      </Panel>
      <Panel title="Times">
        <Times />
      </Panel>
    </>
  );
}

function Admin() {
  const { tab = "traffic" } = Route.useSearch();
  const state = Route.useLoaderData();
  return (
    <>
      <SiteHeader />
      <main className="app-shell admin">
        {/* biome-ignore lint/a11y/useSemanticElements: like ScopeSwitch, a fieldset would need a style reset */}
        <div className="seg" role="group" aria-label="Sections">
          {TABS.map((id) => (
            <Link
              key={id}
              to="/admin"
              search={{ tab: id }}
              className="seg-option admin-tab"
              aria-pressed={id === tab}
            >
              {id}
            </Link>
          ))}
        </div>
        {tab === "traffic" && <TrafficTab />}
        {tab === "players" && <PlayersTab />}
        {tab === "game" && <GameTab />}
        {tab === "requests" && <RequestsTab />}
        {tab === "errors" && <ErrorsTab />}
        {tab === "logs" && <LogsTab />}
        {tab === "live" && <LiveTab first={state} />}
        {tab === "tools" && <ToolsTab />}
      </main>
    </>
  );
}
