import { useEffect, useRef, useState } from "react";

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

export const fixed3 = (value: number) => value.toFixed(3);

/**
 * A number that counts up when it appears and on to its new value when it changes, like the trailer's. It only
 * moves once the first page has hydrated, and not at all for people who asked for less motion. For values that
 * change now and then, not ones that follow a slider.
 */
export function Count({ value, format }: { value: number; format: (value: number) => string }) {
  const element = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  // react only writes the first text: every later one is set here, so a render mid-count can't show the end
  const [first] = useState(() => format(value));
  useEffect(() => {
    const from = shown.current;
    const write = (now: number) => {
      shown.current = now;
      if (element.current) element.current.textContent = format(now);
    };
    if (!live || from === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      write(value);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / DURATION);
      write(progress < 1 ? from + (value - from) * (1 - (1 - progress) ** 4) : value);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, format]);
  return <span ref={element}>{first}</span>;
}
