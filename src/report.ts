import { AppError } from "./i18n/errors";

/*
 * Tells the server of an error the page ran into (server/routes/api/errors.post.ts), so it gets fixed: what broke and
 * on which page, never what the page holds. Only what the site's own code threw is sent, a few times per page load.
 */
const MOST = 5;
const told = new Set<string>();

type Kind = "error" | "promise" | "render";

export function report(kind: Kind, error: unknown) {
  if (!(error instanceof Error) || error instanceof AppError || error.name === "AbortError") return;
  const stack = error.stack ?? "";
  // an extension's script or a request the network dropped isn't the site's to fix
  if (!stack.includes(location.origin) || /fetch|network|load failed/i.test(error.message)) return;
  if (told.size >= MOST || told.has(error.message)) return;
  told.add(error.message);
  fetch("/api/errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ kind, message: error.message, stack, path: location.pathname }),
  }).catch(() => undefined);
}

/** Reports what nothing caught, from the page's load on. */
export function watchErrors() {
  window.addEventListener("error", (event) => report("error", event.error));
  window.addEventListener("unhandledrejection", (event) => report("promise", event.reason));
}
