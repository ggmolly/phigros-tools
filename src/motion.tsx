import { useEffect, useRef, useState } from "react";

const DURATION = 900;
// false while the page the server sent hydrates: its numbers are already there, and stay put
let live = false;
// the numbers shown since the page loaded, as written: one counts the first time it shows, then never again
const counted = new Set<string>();

/** Lets numbers count from then on: mounted once, at the root, whose effect runs after every Count's. */
export function CountsLive() {
  useEffect(() => {
    live = true;
  }, []);
  return null;
}

export const fixed3 = (value: number) => value.toFixed(3);

/**
 * A number that counts up the first time it's shown, and on to its new value when it changes in place (a live
 * update, another song picked), like the trailer's. Coming back to a number already seen doesn't count it again,
 * the first page's numbers never move, and nothing does for people who asked for less motion. For values that
 * change now and then, not ones that follow a slider.
 */
export function Count({ value, format }: { value: number; format: (value: number) => string }) {
  const element = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const mounted = useRef(false);
  // react only writes the first text: every later one is set here, so a render mid-count can't show the end
  const [first] = useState(() => format(value));
  useEffect(() => {
    const from = shown.current;
    const write = (now: number) => {
      shown.current = now;
      if (element.current) element.current.textContent = format(now);
    };
    const seen = !mounted.current && counted.has(format(value));
    mounted.current = true;
    counted.add(format(value));
    if (!live || seen || from === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
