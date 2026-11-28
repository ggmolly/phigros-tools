import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { serverFetch } from "nitro/app";

/** What the server holds right now (`state` in server/admin.ts). */
export interface AdminState {
  build: string;
  uptime: number;
  memory: number;
  log: { waiting: number; dropped: number };
  rooms: { rooms: number; seated: number; watching: number; sockets: number };
  friends: { sockets: number; online: number };
  live: { topics: number };
  players: { all: number; day: number; week: number };
  matches: number;
  replays: Record<string, number>;
}

interface Top {
  name: string;
  views: number;
  visitors: number;
}

/** The pages seen over some days (`traffic` in server/admin.ts). */
export interface Traffic {
  days: { day: string; views: number; visitors: number; bot_views: number }[];
  pages: Top[];
  referrers: Top[];
  countries: Top[];
  browsers: Top[];
  devices: Top[];
  bots: Top[];
  /** The pages on the way to Phigros++ in order, a page of questions once per answer. */
  way: Top[];
  /** The profiles made over those days. */
  profiles: number;
  /** The installer's downloads since its first release, null when GitHub doesn't say. */
  downloads: number | null;
}

/** What /admin opens with, null for anyone the server doesn't name an admin: the page then isn't there. */
export const getAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const response = await serverFetch("/api/admin/state", {
    headers: { cookie: getRequestHeader("cookie") ?? "" },
  });
  return response.ok ? ((await response.json()) as AdminState) : null;
});
