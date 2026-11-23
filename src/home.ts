import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { serverFetch } from "nitro/app";
import type { SaveDocumentV1 } from "./document";
import type { PlayerProfile } from "./plays";

/** What a signed-in Phigros++ player's pages open with: their save as read by the server and their profile. */
export interface Home {
  id: string;
  profile: PlayerProfile;
  /** Undefined until their game uploads a save. */
  document?: SaveDocumentV1;
}

/** The signed-in player of the page's request (its cookie, see server/session.ts), null for anyone else. */
export const getHome = createServerFn({ method: "GET" }).handler(async () => {
  const response = await serverFetch("/api/home", {
    headers: { cookie: getRequestHeader("cookie") ?? "" },
  });
  return response.ok ? ((await response.json()) as Home) : null;
});
