import type { Locale } from "../locales";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { id } from "./id";
import { it } from "./it";
import { ja } from "./ja";
import { ko } from "./ko";
import { ms } from "./ms";
import { vi } from "./vi";
import { zh } from "./zh";
import { zhHant } from "./zh-hant";

/** English is the reference: every other language must have the same keys and shapes. */
export type Messages = typeof en;

export const MESSAGES: Record<Locale, Messages> = {
  en,
  fr,
  es,
  it,
  de,
  zh,
  "zh-Hant": zhHant,
  ja,
  ko,
  vi,
  id,
  ms,
};
