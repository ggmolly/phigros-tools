import { rootRouteId, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";
import type { LiveEvent } from "./topics";

export type LiveListener = (event: LiveEvent, data: string) => void;

// one WebSocket per page (server/live.ts), following the topics of everything mounted
const listeners = new Map<string, Set<LiveListener>>();
let socket: WebSocket | undefined;
let retries = 0;
let retry: ReturnType<typeof setTimeout> | undefined;

// the server is told the whole list, once per change of the mounted pages
let sending = false;
function sendTopics() {
  if (sending) return;
  sending = true;
  queueMicrotask(() => {
    sending = false;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify([...listeners.keys()]));
  });
}

function connect() {
  retry = undefined;
  socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/ws`);
  socket.onopen = () => {
    sendTopics();
    // what changed while it was gone is fetched again
    if (retries)
      for (const each of listeners.values()) for (const listener of each) listener("change", "");
    retries = 0;
  };
  socket.onmessage = (message) => {
    const { topic, event, data } = JSON.parse(message.data);
    for (const listener of listeners.get(topic) ?? []) listener(event, data);
  };
  socket.onclose = () => {
    socket = undefined;
    if (listeners.size) retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retries++));
  };
}

function follow(topic: string, listener: LiveListener) {
  const each = listeners.get(topic) ?? new Set();
  if (!each.size) sendTopics();
  listeners.set(topic, each.add(listener));
  if (!socket && !retry) connect();
  return () => {
    each.delete(listener);
    if (each.size) return;
    listeners.delete(topic);
    sendTopics();
  };
}

/** Calls the listener with the topics' events while the component is mounted, skipping the falsy ones. */
export function useLive(topics: (string | false | undefined)[], listener: LiveListener) {
  const onEvent = useEffectEvent(listener);
  const key = topics.filter(Boolean).join("\n");
  useEffect(() => {
    if (!key) return;
    const stops = key.split("\n").map((topic) => follow(topic, onEvent));
    return () => {
      for (const stop of stops) stop();
    };
  }, [key]);
}

/** What loads the page's own data again, never the root's. */
export function useReload() {
  const router = useRouter();
  return () => void router.invalidate({ filter: (match) => match.routeId !== rootRouteId });
}

/**
 * Reloads once a burst of the topics' events is over (the game sends a few in a row after each song): the page's own
 * data by default.
 */
export function useLiveReload(topics: (string | false | undefined)[], reload?: () => void) {
  const reloadPage = useReload();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLive(topics, () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(reload ?? reloadPage, 500);
  });
}
