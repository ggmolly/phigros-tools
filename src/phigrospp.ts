import { UAParser } from "ua-parser-js";
import { AppError } from "./i18n/errors";
import WORDS from "./words.txt?raw";

/**
 * The site as a Phigros++ device: a browser signs in to a player's phigros.tools profile with its own Ed25519 key
 * (WebCrypto, kept in IndexedDB and never extractable), added to the profile with a code a signed-in device shows. The
 * recovery phrase is the profile's own key: it's only used to make such a code, then dropped.
 */

/** A key signed in to a profile, as `POST /api/devices` lists them. */
export interface Device {
  /** The public key, in hex. */
  key: string;
  /** The device's model or browser, "" for the profile's own key. */
  name: string;
  added: number;
  /** When it last signed a request (ms), 0 for never. */
  seen: number;
  /** The key of the recovery phrase, which can't be removed. */
  phrase: boolean;
  /** The key that asked: this browser. */
  you: boolean;
}

/** What `POST /api/me` says of the profile. */
export interface Me {
  id: string;
  name: string;
  number: number;
  avatar: string;
  /** When the game last uploaded the save, and when one sent from the site waits for it (ms). */
  save: number | null;
  offer: number | null;
}

export interface Signer {
  key: CryptoKey;
  public: Uint8Array;
}

const DOMAIN = "phigros.tools request v1\0";
const PHRASE = 16;
const words = WORDS.split("\n").filter(Boolean);

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

// the stamp only goes forward per key, like the game's (see server/auth.ts)
let stamp = 0;

/** A request signed like Phigros++ signs them: the public key, the signature, the time, then the body. */
export async function call(
  signer: Signer,
  method: string,
  path: string,
  body: Uint8Array | string = "",
): Promise<Response> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  for (let again = false; ; again = true) {
    stamp = Math.max(Date.now(), stamp + 1);
    const message = new Uint8Array(8 + bytes.length);
    new DataView(message.buffer).setBigInt64(0, BigInt(stamp), true);
    message.set(bytes, 8);
    const signed = concat([new TextEncoder().encode(`${DOMAIN}${method} ${path}\n`), message]);
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", signer.key, signed));
    const response = await fetch(path, {
      method,
      body: concat([signer.public, signature, message]),
    });
    if (response.status !== 409 || again) return response;
    stamp = Math.max(stamp, (await response.json()).last);
  }
}

/** The answer's JSON, or why the server refused, for the player. */
export async function answer<T>(response: Response): Promise<T> {
  if (response.ok) return response.json();
  const { code } = await response.json().catch(() => ({}));
  if (code === "removed") throw new AppError("pppRemoved");
  if (code === "no-code") throw new AppError("pppNoCode");
  if (response.status === 403 || response.status === 404) throw new AppError("pppNoProfile");
  throw new AppError("pppServer", String(response.status));
}

/** A new key for this browser, its private half never leaving WebCrypto. */
export async function newSigner(): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey("Ed25519", false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return {
    key: pair.privateKey,
    public: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
}

/** The profile's own key from its 16 words, read by their first 4 letters like the game reads them. */
export async function phraseSigner(phrase: string): Promise<Signer> {
  const typed = phrase.toLowerCase().match(/[a-z]+/g) ?? [];
  const bytes = typed.map((word) => {
    const byte = words.findIndex((w) => w.slice(0, 4) === word.slice(0, 4));
    if (byte < 0) throw new AppError("pppWord", word);
    return byte;
  });
  if (bytes.length !== PHRASE) throw new AppError("pppWords", String(bytes.length));
  const hashed = await crypto.subtle.digest(
    "SHA-512",
    concat([new TextEncoder().encode("phigros++ identity"), new Uint8Array(bytes)]),
  );
  // pkcs8 of a raw ed25519 seed
  const pkcs8 = concat([
    Uint8Array.fromHex("302e020100300506032b657004220420"),
    new Uint8Array(hashed, 0, 32),
  ]);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
  const { x } = await crypto.subtle.exportKey("jwk", key);
  return { key, public: Uint8Array.fromBase64(x!, { alphabet: "base64url" }) };
}

/** This browser as the Devices list names it. */
export function deviceName(): string {
  const { browser, os } = UAParser(navigator.userAgent);
  return [browser.name, os.name].filter(Boolean).join(" on ") || "Browser";
}

/** Joins the profile of a code with a new key for this browser. */
export async function redeem(code: string): Promise<{ signer: Signer; me: Me }> {
  const signer = await newSigner();
  await answer(
    await call(signer, "PUT", "/api/devices", JSON.stringify({ code, name: deviceName() })),
  );
  return { signer, me: await answer<Me>(await call(signer, "POST", "/api/me")) };
}

/** Signs this browser in with the recovery phrase: the phrase's key makes a code, which a new key redeems. */
export async function signInWithPhrase(phrase: string) {
  const owner = await phraseSigner(phrase);
  const { code } = await answer<{ code: string }>(await call(owner, "POST", "/api/invite"));
  return redeem(code);
}

/** Files one after the other, each a 1 byte name length, the name, a 4 byte LE length and the file. */
export function unpack(body: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const files: Record<string, Uint8Array> = {};
  for (let at = 0; at < body.length; ) {
    const name = new TextDecoder().decode(body.subarray(at + 1, at + 1 + body[at]!));
    at += 1 + body[at]!;
    const size = view.getUint32(at, true);
    files[name] = body.subarray(at + 4, at + 4 + size);
    at += 4 + size;
  }
  return files;
}

export function pack(files: Record<string, Uint8Array>): Uint8Array {
  return concat(
    Object.entries(files).flatMap(([name, data]) => {
      const head = new Uint8Array(1 + name.length + 4);
      head[0] = name.length;
      head.set(new TextEncoder().encode(name), 1);
      new DataView(head.buffer).setUint32(1 + name.length, data.length, true);
      return [head, data];
    }),
  );
}
