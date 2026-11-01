import { LOCALES, type Locale, withLocale } from "./i18n/locales";
import { MESSAGES } from "./i18n/messages";

export const SITE = "https://phigros.tools";
export const SITE_NAME = "Phigros Tools";

/** A page's absolute URL in a given language. */
export const localeUrl = (path: string, locale: Locale) => `${SITE}${withLocale(path, locale)}`;

/** The messages for a route's head(), which runs outside React: the language is on the router context. */
export const headT = (match: { context: { i18n: { locale: Locale } } }) => ({
  locale: match.context.i18n.locale,
  t: MESSAGES[match.context.i18n.locale],
});

/**
 * Canonical link for this language's version, plus one alternate per language and x-default (English, whose
 * bare URL also redirects readers to their own language). Search engines index each language separately.
 */
export function pageLinks(path: string, locale: Locale) {
  return [
    { rel: "canonical", href: localeUrl(path, locale) },
    ...LOCALES.map((code) => ({ rel: "alternate", hrefLang: code, href: localeUrl(path, code) })),
    { rel: "alternate", hrefLang: "x-default", href: localeUrl(path, "en") },
  ];
}

interface Image {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** The site-wide preview image (scripts/build-site-og.ts). */
export const siteImage = (locale: Locale): Image => ({
  url: `${SITE}/og.jpg`,
  width: 1200,
  height: 630,
  alt: MESSAGES[locale].seo.siteImageAlt,
});

/** The chart list's preview image, from the same script. */
export const chartsImage = (locale: Locale): Image => ({
  url: `${SITE}/og-charts.jpg`,
  width: 1200,
  height: 630,
  alt: MESSAGES[locale].seo.chartsImageAlt,
});

/** og:locale wants a territory. */
const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  fr: "fr_FR",
  es: "es_ES",
  it: "it_IT",
  de: "de_DE",
  zh: "zh_CN",
  "zh-Hant": "zh_TW",
  ja: "ja_JP",
  ko: "ko_KR",
  vi: "vi_VN",
  id: "id_ID",
  ms: "ms_MY",
};

/**
 * Every tag a page needs for search results and link previews (Discord, X, Telegram…). Child routes'
 * tags replace the root's by name/property, so each page passes all of them. `title` is the page's own
 * name: `<title>` gets the site name appended, og:title doesn't since previews already show og:site_name.
 * The default theme colour is the logo's glow, bright enough to show as a Discord embed's stripe.
 */
export function pageMeta({
  title,
  description,
  path,
  locale,
  image = siteImage(locale),
  themeColor = "#8fdcff",
  type = "website",
}: {
  title: string;
  description: string;
  path: string;
  locale: Locale;
  image?: Image;
  themeColor?: string;
  type?: "website" | "music.song";
}) {
  return [
    { title: title === SITE_NAME ? title : `${title} · ${SITE_NAME}` },
    { name: "description", content: description },
    { name: "theme-color", content: themeColor },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: type },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: localeUrl(path, locale) },
    { property: "og:locale", content: OG_LOCALE[locale] },
    { property: "og:image", content: image.url },
    { property: "og:image:width", content: String(image.width) },
    { property: "og:image:height", content: String(image.height) },
    { property: "og:image:alt", content: image.alt },
    { name: "twitter:card", content: "summary_large_image" },
  ];
}

/** A `<script type="application/ld+json">` head entry; "<" is escaped so the JSON can't close the tag. */
export function jsonLd(data: object) {
  return {
    type: "application/ld+json",
    children: JSON.stringify({ "@context": "https://schema.org", ...data }).replace(
      /</g,
      "\\u003c",
    ),
  };
}

export function breadcrumbs(trail: [name: string, path: string][], locale: Locale) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, path], index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: localeUrl(path, locale),
    })),
  };
}
