import { Link } from "@tanstack/react-router";
import { useT } from "../i18n";

// the answers drawn like the game's icons, a phone or tablet told apart by what its screen shows
const PHONE = "M21 5h22v38H21z";
const BOTH = "M42 10V6H4v28h32M36 10h22v36H36z";
const ICONS = {
  android: `${BOTH}M43.6 41v2.4l-2.4-1.2zM48.2 42.2a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0M50.4 41h2.4v2.4h-2.4zM46.5 14.5h1M15 31h10M22.5 9.5h1`,
  ios: `${BOTH}M44 15h6M43 43h8M15 31h10`,
  gone: PHONE,
  rooted: `${PHONE}M30 16.5l-1.5 15M36 16.5l-1.5 15M26 21h12.5M25.5 27H38`,
  unrooted: `${PHONE}M26.5 23h11v9.5h-11zM28.5 23v-3.5a3.5 3.5 0 0 1 7 0V23`,
};

type Answers = Record<string, string | boolean | undefined>;
export type Option = { icon: keyof typeof ICONS; label: string; search: Answers };

/** One question of a page whose answers are its address: its answers as tiles, or the one given as a chip leading back to it. */
export function Question({
  to,
  title,
  answer,
  options,
  back,
}: {
  to: "/start" | "/phigrospp";
  title: string;
  answer?: string;
  options: Option[];
  back: Answers;
}) {
  const t = useT();
  if (answer)
    return (
      <Link to={to} search={back} resetScroll={false} className="btn btn-ghost start-answer">
        <span>
          <strong>{answer}</strong>
          <small>{title}</small>
        </span>
        <u>{t.start.change}</u>
      </Link>
    );
  return (
    <div className="start-question">
      <h2 tabIndex={-1}>{title}</h2>
      <div className="start-tiles">
        {options.map(({ icon, label, search }) => (
          <Link key={icon} to={to} search={search} resetScroll={false} className="start-tile">
            <svg aria-hidden="true" viewBox="0 0 64 48" data-icon={icon}>
              <path d={ICONS[icon]} />
            </svg>
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
