import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { LOCALE_COOKIE, type Locale, splitLocale, withLocale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

const ZONE_COOKIE = "tz";
const LocaleContext = createContext<Locale>("en");
const ZoneContext = createContext("UTC");

/** The reader's time zone as their browser last told it (I18nProvider), UTC until it has. */
export const getTimeZone = createServerFn({ method: "GET" }).handler(() => {
  const zone = getCookie(ZONE_COOKIE) ?? "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
});

// dates are written in the zone the server was given, so the page hydrates as it was rendered, then in the
// browser's own zone, which the next page's request carries
export function I18nProvider({
  locale,
  timeZone,
  children,
}: {
  locale: Locale;
  timeZone: string;
  children: ReactNode;
}) {
  const [zone, setZone] = useState(timeZone);
  useLayoutEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.cookie = `${ZONE_COOKIE}=${local}; path=/; max-age=31536000; samesite=lax`;
    setZone(local);
  }, []);
  return (
    <LocaleContext.Provider value={locale}>
      <ZoneContext.Provider value={zone}>{children}</ZoneContext.Provider>
    </LocaleContext.Provider>
  );
}

export const useLocale = () => useContext(LocaleContext);

/** The current language's messages. */
export function useT(): Messages {
  return MESSAGES[useLocale()];
}

/** Number and date formatters for the current language. */
export function useFormat() {
  const locale = useLocale();
  const timeZone = useContext(ZoneContext);
  return useMemo(
    () => ({
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        value.toLocaleString(locale, options),
      date: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) =>
        new Date(value).toLocaleDateString(locale, { timeZone, ...options }),
    }),
    [locale, timeZone],
  );
}

/**
 * Remembers the choice for a year (so the bare URLs redirect to it, see server/middleware/locale.ts) and loads
 * the same page under the new language's prefix.
 */
export function setLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  const { path } = splitLocale(location.pathname);
  location.assign(`${withLocale(path, locale)}${location.search}${location.hash}`);
}

/**
 * A message with **bold** spans, rendered as <strong>, and `code` ones; messages stay plain strings so every language
 * can place them. With an `href`, the bold spans link to it.
 */
export function Rich({ text, href }: { text: string; href?: string }) {
  // biome-ignore-start lint/suspicious/noArrayIndexKey: the parts never reorder.
  return text
    .split(/(\*\*.*?\*\*|`.*?`)/)
    .map((part, index) =>
      part.startsWith("**") ? (
        <strong key={index}>
          {href ? <a href={href}>{part.slice(2, -2)}</a> : part.slice(2, -2)}
        </strong>
      ) : part.startsWith("`") ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
  // biome-ignore-end lint/suspicious/noArrayIndexKey: the parts never reorder.
}
