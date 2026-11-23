import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as v from "valibot";
import { type AdminState, getAdmin, type Traffic } from "../admin";
import { SiteHeader } from "../components/chrome";
import { Stat } from "../components/primitives";
import { LinePlot } from "../components/rks-history";
import { useFormat } from "../i18n";
import styles from "../styles/admin.css?url";

/*
 * What the admins see of the site (server/admin.ts): the pages seen, the requests and how they went, the errors of
 * the server and of the pages, the logs to search, and what the server holds right now. It's in English only: the
 * languages' messages are sent to every visitor, and this page has a handful of readers.
 */

const TABS = ["traffic", "requests", "errors", "logs", "live"] as const;
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

const when = (time: string) => new Date(time).toLocaleString("en-GB", { hour12: false });
const searching = (q: string) => ({ tab: "logs" as const, q });

function TrafficTab() {
  const { days = 30 } = Route.useSearch();
  const format = useFormat();
  const { data, error } = useAsked<Traffic>(`/api/admin/traffic?days=${days}`, json);
  const sum = (field: "views" | "visitors" | "bot_views") =>
    data?.days.reduce((total, day) => total + day[field], 0) ?? 0;
  const tops = [
    ["Pages", data?.pages],
    ["Referrers", data?.referrers],
    ["Countries", data?.countries],
    ["Browsers", data?.browsers],
    ["Devices", data?.devices],
    ["Bots", data?.bots],
  ] as const;
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
      <div className="admin-tops">
        {tops.map(([title, top]) => (
          <section className="panel" key={title}>
            <h2 className="panel-title">{title}</h2>
            <Table
              head={[title, "Views", "Visitors"]}
              rows={(top ?? []).map((row) => [row.name || "none", row.views, row.visitors])}
            />
          </section>
        ))}
      </div>
    </>
  );
}

function RequestsTab() {
  const { range = "24h" } = Route.useSearch();
  const asked = `_time:${range} _msg:=http`;
  const failed = "count() if (status:>=500) as errors";
  const rate = useLogs(
    `${asked} | stats by (_time:${STEP[range]}) count() as n, ${failed} | sort by (_time)`,
  );
  const routes = useLogs(
    `${asked} | stats by (route) count() as n, ${failed}, quantile(0.5, ms) as p50, quantile(0.95, ms) as p95, quantile(0.99, ms) as p99 | sort by (n) desc`,
  );
  const points = rate.data ?? [];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Requests</h2>
        <Choice options={RANGES} chosen={range} name="range" />
      </div>
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
              <span>{points[at]!.errors} failed</span>
            </>
          )}
        />
      )}
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
    </section>
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
  const navigate = Route.useNavigate();
  const { data, error } = useLogs(`_time:${range} ${q || "*"} | sort by (_time) desc`, 200);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Logs</h2>
        <Choice options={RANGES} chosen={range} name="range" />
      </div>
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = new FormData(event.currentTarget).get("q");
          void navigate({ search: (search) => ({ ...search, q: String(typed) || undefined }) });
        }}
      >
        <input
          key={q}
          className="field"
          name="q"
          defaultValue={q}
          aria-label="LogsQL query"
          placeholder="player:=275be6d045c7, rid:=…, _msg:=http status:>=500"
        />
        <button type="submit" className="btn">
          Search
        </button>
      </form>
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

function LiveTab({ first }: { first: AdminState }) {
  const { data = first, error } = useAsked<AdminState>("/api/admin/state", json, 5000);
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
        <section className="panel" key={title}>
          <div className="panel-head">
            <h2 className="panel-title">{title}</h2>
            {title === "Server" && <span className="panel-count">build {data.build}</span>}
          </div>
          <div className="stat-bar">
            <div className="stat-row">
              {stats.map(([label, value]) => (
                <Stat key={label} label={label} value={value} />
              ))}
            </div>
          </div>
        </section>
      ))}
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
        {tab === "requests" && <RequestsTab />}
        {tab === "errors" && <ErrorsTab />}
        {tab === "logs" && <LogsTab />}
        {tab === "live" && <LiveTab first={state} />}
      </main>
    </>
  );
}
