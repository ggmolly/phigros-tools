import { createServerFn } from "@tanstack/react-start";
import * as v from "valibot";
import { CLOUD, type Region } from "./save";

/*
 * "Log in with TapTap" the way the game's SDK does on a device without a browser: the OAuth 2.0 device flow.
 * 1. Ask TapTap for a device code; its URL is shown as a QR code (or opened directly on the same phone).
 * 2. Poll until the player approves it in TapTap, which yields a MAC token.
 * 3. Read the TapTap profile (open id, union id) with a request signed by that token.
 * 4. Log in to the game's LeanCloud app with both, which returns the Phigros session token.
 * Every step runs in the browser except 3: open.tapapis.com doesn't answer CORS preflights, so the server relays
 * that one GET. It only ever sees the finished, single-use signature, never the MAC key or the session token.
 */

const TAPTAP: Record<Region, { accounts: string; profile: string }> = {
  global: { accounts: "https://accounts.tapapis.com", profile: "https://open.tapapis.com" },
  china: { accounts: "https://accounts.tapapis.cn", profile: "https://open.tapapis.cn" },
};
const profileUrl = (region: Region) =>
  `${TAPTAP[region].profile}/account/profile/v1?client_id=${CLOUD[region].id}`;

export interface LoginCode {
  region: Region;
  deviceId: string;
  deviceCode: string;
  userCode: string;
  url: string;
  interval: number;
  expiresAt: number;
}

interface MacToken {
  kid: string;
  access_token: string;
  token_type: string;
  mac_key: string;
  mac_algorithm: string;
}

const codeResponse = v.object({
  data: v.object({
    device_code: v.string(),
    user_code: v.string(),
    qrcode_url: v.pipe(v.string(), v.url()),
    expires_in: v.number(),
    interval: v.number(),
  }),
});
const tokenResponse = v.object({
  data: v.object({
    kid: v.string(),
    access_token: v.string(),
    token_type: v.string(),
    mac_key: v.string(),
    mac_algorithm: v.picklist(["hmac-sha-1", "hmac-sha-256"]),
  }),
});
const profileResponse = v.object({
  data: v.object({
    openid: v.string(),
    unionid: v.optional(v.string(), ""),
    name: v.optional(v.string(), ""),
    avatar: v.optional(v.string(), ""),
  }),
});

async function post(url: string, fields: Record<string, string>, signal?: AbortSignal) {
  // A form body and no custom headers keep these "simple" requests: no CORS preflight.
  const response = await fetch(url, { method: "POST", body: new URLSearchParams(fields), signal });
  return { ok: response.ok, body: (await response.json()) as unknown };
}

export async function requestLoginCode(region: Region, signal?: AbortSignal): Promise<LoginCode> {
  const deviceId = crypto.randomUUID();
  const { ok, body } = await post(
    `${TAPTAP[region].accounts}/oauth2/v1/device/code`,
    {
      client_id: CLOUD[region].id,
      response_type: "device_code",
      scope: "public_profile",
      version: "2.1",
      platform: "unity",
      info: JSON.stringify({ device_id: deviceId }),
    },
    signal,
  );
  const parsed = v.safeParse(codeResponse, body);
  if (!ok || !parsed.success) throw new Error("TapTap didn't return a login code. Try again.");
  const data = parsed.output.data;
  return {
    region,
    deviceId,
    deviceCode: data.device_code,
    userCode: data.user_code,
    url: data.qrcode_url,
    interval: Math.max(data.interval, 1),
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export type LoginStatus = "waiting" | "scanned" | "approved";

/** Poll until the player approves the code in TapTap. Throws once they refuse or the code expires. */
async function waitForApproval(
  code: LoginCode,
  onStatus: (status: LoginStatus) => void,
  signal?: AbortSignal,
): Promise<MacToken> {
  while (Date.now() < code.expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, code.interval * 1000));
    signal?.throwIfAborted();
    const { ok, body } = await post(
      `${TAPTAP[code.region].accounts}/oauth2/v1/token`,
      {
        grant_type: "device_token",
        client_id: CLOUD[code.region].id,
        secret_type: "hmac-sha-1",
        code: code.deviceCode,
        version: "1.0",
        platform: "unity",
        info: JSON.stringify({ device_id: code.deviceId }),
      },
      signal,
    );
    const token = v.safeParse(tokenResponse, body);
    if (ok && token.success) return token.output.data;
    const error = (body as { data?: { error?: string } }).data?.error;
    if (error === "authorization_waiting") onStatus("scanned");
    else if (error === "access_denied") throw new Error("The login was declined in TapTap.");
    else if (error !== "authorization_pending")
      throw new Error(`TapTap login failed: ${error ?? "unexpected response"}`);
  }
  throw new Error("The login code expired. Get a new one and try again.");
}

/** TapTap's MAC request signature (the scheme its SDKs use for the profile endpoint). */
async function signRequest(token: MacToken, method: string, url: string): Promise<string> {
  const { host, pathname, search } = new URL(url);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1;
  const payload = `${ts}\n${nonce}\n${method}\n${pathname}${search}\n${host}\n443\n\n`;
  const hash = token.mac_algorithm === "hmac-sha-256" ? "SHA-256" : "SHA-1";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token.mac_key),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `MAC id="${token.kid}",ts="${ts}",nonce="${nonce}",mac="${mac.toBase64()}"`;
}

const profileInput = v.object({
  region: v.picklist(["global", "china"]),
  authorization: v.pipe(
    v.string(),
    v.regex(/^MAC id="[^"\\]{1,256}",ts="\d{1,12}",nonce="\d{1,12}",mac="[A-Za-z0-9+/=]{1,128}"$/),
  ),
});

/** The one relayed call (see the top of this file). Fixed URLs only, and nothing is stored or logged. */
export const getTapTapProfile = createServerFn({ method: "POST" })
  .validator((input: unknown) => v.parse(profileInput, input))
  .handler(async ({ data }) => {
    const response = await fetch(profileUrl(data.region), {
      headers: { Authorization: data.authorization },
    });
    const profile = v.safeParse(profileResponse, await response.json().catch(() => null));
    if (!response.ok || !profile.success)
      throw new Error(`TapTap profile lookup failed: HTTP ${response.status}`);
    return profile.output.data;
  });

/**
 * Wait for approval, then exchange the TapTap login for the game's session token. `failOnNotExist` makes LeanCloud
 * refuse TapTap accounts that never played, instead of creating an empty Phigros account for them.
 */
export async function completeLogin(
  code: LoginCode,
  onStatus: (status: LoginStatus) => void,
  signal?: AbortSignal,
): Promise<{ token: string; objectId: string; nickname?: string }> {
  const token = await waitForApproval(code, onStatus, signal);
  onStatus("approved");
  const authorization = await signRequest(token, "GET", profileUrl(code.region));
  const profile = await getTapTapProfile({ data: { region: code.region, authorization } });
  signal?.throwIfAborted();
  const cloud = CLOUD[code.region];
  const response = await fetch(`${cloud.api}/users?failOnNotExist=true`, {
    method: "POST",
    signal,
    headers: { "X-LC-Id": cloud.id, "X-LC-Key": cloud.key, "Content-Type": "application/json" },
    body: JSON.stringify({ authData: { taptap: { ...token, ...profile } } }),
  });
  const user = (await response.json()) as {
    sessionToken?: string;
    objectId?: string;
    nickname?: string;
    code?: number;
  };
  if (user.code === 211)
    throw new Error(
      `This TapTap account has no Phigros ${code.region === "china" ? "China" : "global"} save. Check the region, and sync once in the game.`,
    );
  if (!response.ok || !user.sessionToken || !user.objectId)
    throw new Error(`Phigros login failed: HTTP ${response.status}`);
  return { token: user.sessionToken, objectId: user.objectId, nickname: user.nickname };
}
