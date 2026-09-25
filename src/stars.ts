import { createServerFn } from "@tanstack/react-start";

const REPO = "ggmolly/phigros-tools";
const TTL_MS = 60 * 60 * 1000; // 1h

let cache: { stars: number; at: number } | undefined;

/** GitHub star count for the header link: fetched on the server, cached for an hour, null if GitHub is unreachable. */
export const getStars = createServerFn({ method: "GET" }).handler(
  async (): Promise<number | null> => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.stars;
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "phigros.tools" },
      });
      if (!response.ok) return cache?.stars ?? null;
      const data = (await response.json()) as { stargazers_count: number };
      cache = { stars: data.stargazers_count, at: Date.now() };
      return cache.stars;
    } catch {
      return cache?.stars ?? null;
    }
  },
);
