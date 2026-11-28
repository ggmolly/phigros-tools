import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { serverFetch } from "nitro/app";
import type { ASKED } from "../server/admin";

/** What each name /admin asks for answers (`ASKED` in server/admin.ts): only the types are taken from the server. */
export type Asked = { [What in keyof typeof ASKED]: Awaited<ReturnType<(typeof ASKED)[What]>> };

/** What /admin opens with, null for anyone the server doesn't name an admin: the page then isn't there. */
export const getAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const response = await serverFetch("/api/admin/state", {
    headers: { cookie: getRequestHeader("cookie") ?? "" },
  });
  return response.ok ? ((await response.json()) as Asked["state"]) : null;
});
