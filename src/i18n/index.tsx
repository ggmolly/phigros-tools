import { createContext, type ReactNode, useContext, useMemo } from "react";
import { LOCALE_COOKIE, type Locale, splitLocale, withLocale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

const LocaleContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

/** The current language's messages. */
export function useT(): Messages {
  return MESSAGES[useLocale()];
}

/** Number and date formatters for the current language. */
export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        value.toLocaleString(locale, options),
      date: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) =>
        new Date(value).toLocaleDateString(locale, options),
    }),
    [locale],
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

/** A message with **bold** spans, rendered as <strong>; messages stay plain strings so every language can place them. */
export function Rich({ text }: { text: string }) {
  return text.split("**").map((part, index) =>
    index % 2 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder.
      <strong key={index}>{part}</strong>
    ) : (
      part
    ),
  );
}
