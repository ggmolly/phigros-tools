import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import {
  type AdbDaemonWebUsbConnection,
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";
import type { Messages } from "./i18n/messages";

const PKG = "com.PigeonGames.Phigros";
const USERDATA = `/sdcard/Android/data/${PKG}/files/.userdata`;

export type Log = (message: string) => void;

/** The TapTap/TDS account the game is logged in as. */
export interface Account {
  nickname?: string;
  objectId?: string;
  shortId?: string;
}

export interface Session {
  token: string;
  account: Account;
}

/** Pull the LeanCloud sessionToken and account out of the game's persisted `LCUser`. */
function parseUserdata(userdata: string): { token?: string; account: Account } {
  let user: Record<string, string | undefined>;
  try {
    user = JSON.parse(userdata) ?? {};
  } catch {
    // the SDK writes pretty-printed JSON, but don't bet the farm on it
    const pick = (key: string) => new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(userdata)?.[1];
    user = Object.fromEntries(
      ["sessionToken", "nickname", "objectId", "shortId"].map((key) => [key, pick(key)]),
    );
  }
  const { sessionToken, nickname, objectId, shortId } = user;
  return { token: sessionToken || undefined, account: { nickname, objectId, shortId } };
}

/** `"name" (id 6aabe…370, short 12345)` — whatever of it we actually have. */
function describeAccount(account: Account): string {
  const name = account.nickname ? `“${account.nickname}”` : "(no nickname)";
  const bits = [
    account.objectId && `id ${account.objectId}`,
    account.shortId && `short ${account.shortId}`,
  ].filter(Boolean);
  return bits.length ? `${name} (${bits.join(", ")})` : name;
}

/**
 * Talk ADB to a USB-attached Android phone and read the game's login blob.
 * The browser becomes the ADB host, so the phone shows its normal
 * "Allow USB debugging?" prompt; the RSA key lives in IndexedDB.
 */
export async function readSessionToken(
  log: Log,
  text: Messages["save"]["usb"],
  signal?: AbortSignal,
): Promise<Session> {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) {
    throw new Error(text.unavailable);
  }

  // Reconnects after the first grant skip the picker entirely.
  const granted = await manager.getDevices();
  log(granted.length === 1 ? text.reusing : text.picking);
  const device = granted.length === 1 ? granted[0] : await manager.requestDevice();
  if (!device) throw new Error(text.noDevice);
  signal?.throwIfAborted();
  const closeOnAbort = () => {
    void device.raw.close().catch(() => undefined);
  };
  signal?.addEventListener("abort", closeOnAbort, { once: true });
  try {
    log(text.selected(device.name, device.serial));

    log(text.handshaking);
    let connection: AdbDaemonWebUsbConnection;
    try {
      connection = await device.connect();
    } catch (error) {
      if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
        throw new Error(text.busy, { cause: error });
      }
      throw error;
    }
    signal?.throwIfAborted();
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: new AdbWebCredentialStore("Phigros Cloud Save"),
    });

    try {
      signal?.throwIfAborted();
      const adb = new Adb(transport);
      log(text.connected(adb.serial));
      const timeout = AbortSignal.timeout(30_000);
      const stop = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let removeAbort: () => void = () => undefined;
      const interrupted = new Promise<never>((_, reject) => {
        const onAbort = () => {
          if (timeout.aborted) void device.raw.close().catch(() => undefined);
          reject(stop.reason);
        };
        if (stop.aborted) onAbort();
        else stop.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => stop.removeEventListener("abort", onAbort);
      });
      let userdata: string;
      try {
        userdata = await Promise.race([
          adb.subprocess.noneProtocol.spawnWaitText(["cat", USERDATA]),
          interrupted,
        ]);
      } catch (error) {
        if (timeout.aborted && !signal?.aborted) throw new Error(text.timeout, { cause: error });
        throw error;
      } finally {
        removeAbort();
      }
      signal?.throwIfAborted();
      if (!userdata.trim()) {
        throw new Error(text.empty(USERDATA));
      }
      const { token, account } = parseUserdata(userdata);
      if (!token) {
        throw new Error(text.noToken(USERDATA, String(userdata.length)));
      }
      log(text.read(USERDATA, String(userdata.length)));
      log(text.loggedIn(describeAccount(account)));
      log(text.tokenLength(token.length));
      return { token, account };
    } finally {
      await transport.close();
    }
  } finally {
    signal?.removeEventListener("abort", closeOnAbort);
    if (signal?.aborted) await device.raw.close().catch(() => undefined);
  }
}
