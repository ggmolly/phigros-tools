export const LOCALES = [
  "en",
  "fr",
  "es",
  "it",
  "de",
  "zh",
  "zh-Hant",
  "ja",
  "ko",
  "vi",
  "id",
  "ms",
] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "lang";

/** Each language's name in itself, for the switcher. */
export const LOCALE_NAME: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  de: "Deutsch",
  zh: "简体中文",
  "zh-Hant": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
  ms: "Bahasa Melayu",
};

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** Picks the first supported language from an Accept-Language header, by q-value; English otherwise. */
export function negotiateLocale(header: string | undefined): Locale {
  if (!header) return "en";
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1, index };
    })
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const [base, ...rest] = tag.split("-");
    // Taiwan, Hong Kong and Macau read Traditional Chinese, as does any tag that says so.
    if (base === "zh" && rest.some((part) => ["hant", "tw", "hk", "mo"].includes(part)))
      return "zh-Hant";
    if (isLocale(base)) return base;
  }
  return "en";
}

/** English lives at the bare paths; every other language under its own prefix (/fr/charts…). */
export const localePrefix = (locale: Locale) => (locale === "en" ? "" : `/${locale}`);

/** Splits "/fr/charts" into the language and the path the routes know ("/charts"). */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const [, first = "", ...rest] = pathname.split("/");
  return isLocale(first) && first !== "en"
    ? { locale: first, path: `/${rest.join("/")}` }
    : { locale: "en", path: pathname };
}

export const withLocale = (path: string, locale: Locale) =>
  `${localePrefix(locale)}${path === "/" && locale !== "en" ? "" : path}`;
