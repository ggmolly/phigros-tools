import { isLocale, type Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

type Errors = Messages["errors"];
type ErrorKey = keyof Errors;
/** A message's arguments; any of them may be another error, translated in turn (e.g. why a ZIP is invalid). */
type Args<K extends ErrorKey> = Errors[K] extends (...args: infer A) => string
  ? { [I in keyof A]: A[I] | Error }
  : [];

/**
 * An error shown to players: it carries a message key instead of a sentence, so it's translated when displayed
 * (see `errorText`). Its plain `message` is the English one, for logs.
 */
export class AppError<K extends ErrorKey = ErrorKey> extends Error {
  readonly args: Args<K>;
  constructor(
    readonly key: K,
    ...args: Args<K>
  ) {
    super(render("en", key, args));
    this.args = args;
  }
}

function render(locale: Locale, key: ErrorKey, args: readonly unknown[]): string {
  const entry = MESSAGES[locale].errors[key] as string | ((...args: string[]) => string);
  return typeof entry === "string" ? entry : entry(...args.map((arg) => errorText(arg, locale)));
}

/** An error (or anything thrown) as text in the page's language. */
export function errorText(error: unknown, locale?: Locale): string {
  const lang = locale ?? (typeof document !== "undefined" ? document.documentElement.lang : "");
  if (error instanceof AppError) return render(isLocale(lang) ? lang : "en", error.key, error.args);
  return error instanceof Error ? error.message : String(error);
}
