import { useEffect, useRef } from "react";

const DURATION = 900;
// false while the page the server sent hydrates: its numbers are already there, and stay put
let live = false;

/** Lets numbers count from then on: mounted once, at the root, whose effect runs after every Count's. */
export function CountsLive() {
  useEffect(() => {
    live = true;
  }, []);
  return null;
}

/**
 * A number that counts up when it appears and on to its new value when it changes, like the trailer's. It only
 * moves once the first page has hydrated, and not at all for people who asked for less motion.
 */
export function Count({ value, format }: { value: number; format: (value: number) => string }) {
  const element = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const from = shown.current;
    shown.current = value;
    if (!live || from === value || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / DURATION);
      const eased = 1 - (1 - progress) ** 4;
      if (element.current) element.current.textContent = format(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, format]);
  return <span ref={element}>{format(value)}</span>;
}
