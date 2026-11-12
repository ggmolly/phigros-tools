import { useEffect, useEffectEvent } from "react";

/** A player's event (server/events.ts): "save" with when their game uploaded it (ms), "change" for anything else. */
export type LiveListener = (event: "save" | "change", data: string) => void;

// one connection per player, shared by everything on the page that follows them
const sources = new Map<string, { source: EventSource; listeners: Set<LiveListener> }>();

function follow(id: string, listener: LiveListener) {
  let entry = sources.get(id);
  if (!entry) {
    const source = new EventSource(`/api/players/${id}/events`);
    const listeners = new Set<LiveListener>();
    const emit = (event: "save" | "change", data = "") => {
      for (const each of listeners) each(event, data);
    };
    source.addEventListener("save", (e) => emit("save", e.data));
    source.addEventListener("change", () => emit("change"));
    // the browser reconnects on its own, what changed meanwhile is fetched again
    let lost = false;
    source.addEventListener("error", () => {
      lost = true;
    });
    source.addEventListener("open", () => {
      if (lost) emit("change");
      lost = false;
    });
    entry = { source, listeners };
    sources.set(id, entry);
  }
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size) return;
    entry.source.close();
    sources.delete(id);
  };
}

/** Calls the listener with the player's events while the component is mounted, none for no player. */
export function useLive(id: string | undefined, listener: LiveListener) {
  const onEvent = useEffectEvent(listener);
  useEffect(() => {
    if (id) return follow(id, (event, data) => onEvent(event, data));
  }, [id]);
}
