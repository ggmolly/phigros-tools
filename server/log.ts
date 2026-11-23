import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import type { H3Event } from "nitro/h3";

/*
 * What the server and the worker say of what they do: one JSON object per line on stdout, also sent to VictoriaLogs
 * when LOGS_URL names one, which keeps them 90 days for /admin to read (server/admin.ts). A line names its event and
 * carries what tells one from another, a player's public id at most: never an address, a request's body, a key, a
 * password, a room's name or a chat line. time, level, event, proc and build are the line's own: no field takes
 * their names.
 */
const LOGS = process.env.LOGS_URL;
const BATCH = 500; // lines sent at once
const KEPT = 10_000; // lines waiting while VictoriaLogs is away, the oldest dropped past it
// the replay worker is started as worker.mjs, or server/worker.ts from the sources. vite runs the server in a
// thread of that name
const worker = Bun.isMainThread && /^worker\.(mjs|ts)$/.test(basename(Bun.main));
const proc = worker ? "worker" : "app";
/** The commit the server was built from (`bun run build`), "dev" otherwise. */
export const build = existsSync("./build") ? readFileSync("./build", "utf8").trim() : "dev";

type Fields = Record<string, unknown>;
type Level = "info" | "warn" | "error";

// what a request carries to its line: its id, when it began, who signed it and what its handler noted
declare module "h3" {
  interface H3EventContext {
    rid?: string;
    began?: number;
    player?: string;
    log?: Fields;
  }
}

const waiting: string[] = [];
let dropped = 0;
let sending: Promise<void> | undefined;

// drizzle's message for a query that failed quotes the values it was sent, and h3 wraps what a handler threw with
// that message: the line has the database's own words and the query without its values
function told(error: unknown): Fields {
  if (!(error instanceof Error)) return { error: String(error).slice(0, 500) };
  const failed = [error, error.cause].find(
    (each): each is Error & { query: string } =>
      each instanceof Error && "query" in each && "params" in each,
  );
  if (failed)
    return {
      ...told(failed.cause),
      query: failed.query.slice(0, 2000),
      stack: failed.stack?.replace(failed.message, "").slice(0, 4000),
    };
  return { error: error.message.slice(0, 500), stack: error.stack?.slice(0, 4000) };
}

function write(level: Level, event: string, { error, ...fields }: Fields = {}) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    proc,
    build,
    ...fields,
    ...(error === undefined ? {} : told(error)),
  });
  process.stdout.write(`${line}\n`);
  if (!LOGS) return;
  if (waiting.length >= KEPT) {
    waiting.shift();
    dropped += 1;
  }
  waiting.push(line);
  if (waiting.length >= BATCH) void flush();
}

async function send() {
  while (waiting.length) {
    const batch = waiting.splice(0, BATCH);
    try {
      const sent = await fetch(
        `${LOGS}/insert/jsonline?_stream_fields=proc&_time_field=time&_msg_field=event`,
        {
          method: "POST",
          // any other type is answered 200 and thrown away
          headers: { "content-type": "application/stream+json" },
          body: batch.join("\n"),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!sent.ok) throw new Error(`HTTP ${sent.status}`);
    } catch {
      // they stay first in line for the next try, a request never waits for its line
      waiting.unshift(...batch);
      return;
    }
    if (dropped) write("warn", "log.dropped", { count: dropped });
    dropped = 0;
  }
}

/** Sends the lines that wait, which the server and the worker do before they stop. */
export function flush(): Promise<void> {
  sending ??= send().finally(() => {
    sending = undefined;
  });
  return sending;
}
if (LOGS) setInterval(flush, 1000).unref();

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

/** Adds to the one line a request gets once it's answered (server/plugins/log.ts). */
export function note(event: H3Event, fields: Fields) {
  event.context.log = { ...event.context.log, ...fields };
}

/** How many lines wait for VictoriaLogs, and how many were dropped since it last took some. */
export const logged = () => ({ waiting: waiting.length, dropped });

// what the libraries print lands in the same lines: the errors TanStack Start catches while rendering a page are
// only ever printed
if (build !== "dev")
  for (const level of ["warn", "error"] as const)
    console[level] = (...said: unknown[]) =>
      write(level, "console", {
        message: said
          .filter((part) => !(part instanceof Error))
          .map((part) => (typeof part === "string" ? part : Bun.inspect(part)))
          .join(" ")
          .slice(0, 2000),
        error: said.find((part) => part instanceof Error),
      });
