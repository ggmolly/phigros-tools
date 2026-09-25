export const SITE = "https://phigros.tools";
export const SITE_NAME = "Phigros Tools";
export const SITE_DESCRIPTION =
  "Analyze your Phigros save: ranking score, Best charts, chart records and progress, privately in your browser. Plus every chart's difficulty constant.";

interface Image {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** The site-wide preview image (scripts/build-site-og.ts). */
const SITE_IMAGE: Image = {
  url: `${SITE}/og.jpg`,
  width: 1200,
  height: 630,
  alt: "Phigros Tools: ranking score, Best charts and every chart constant",
};

/** The chart list's preview image, from the same script. */
export const CHARTS_IMAGE: Image = {
  url: `${SITE}/og-charts.jpg`,
  width: 1200,
  height: 630,
  alt: "Phigros Tools: every chart's difficulty constant",
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
  image = SITE_IMAGE,
  themeColor = "#8fdcff",
  type = "website",
}: {
  title: string;
  description: string;
  path: string;
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
    { property: "og:url", content: `${SITE}${path}` },
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

export function breadcrumbs(trail: [name: string, path: string][]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, path], index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: `${SITE}${path}`,
    })),
  };
}
