import { defineHandler, getQuery, getRouterParam, HTTPError } from "nitro/h3";
import { allowed } from "../../../../admin";

const KINDS = ["query", "hits"];
const PASSED = ["query", "start", "end", "step", "field"];
const LIMIT = 1000;

// a LogsQL query of /admin, asked of VictoriaLogs here: nothing else reaches it. `query` answers with the lines
// (JSON, one per line), `hits` with how many there were over time
export default defineHandler(async (event) => {
  await allowed(event);
  const kind = getRouterParam(event, "kind")!;
  const logs = process.env.LOGS_URL;
  if (!KINDS.includes(kind) || !logs) throw HTTPError.status(404);
  const asked = getQuery(event);
  const form = new URLSearchParams({ timeout: "10s" });
  for (const name of PASSED) if (asked[name]) form.set(name, String(asked[name]));
  if (kind === "query") form.set("limit", String(Math.min(LIMIT, Number(asked.limit) || LIMIT)));
  const answer = await fetch(`${logs}/select/logsql/${kind}`, { method: "POST", body: form });
  return new Response(answer.body, {
    status: answer.status,
    headers: { "content-type": answer.headers.get("content-type") ?? "text/plain" },
  });
});
