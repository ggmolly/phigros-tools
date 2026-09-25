import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import {
  type AdbDaemonWebUsbConnection,
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";

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
export async function readSessionToken(log: Log, signal?: AbortSignal): Promise<Session> {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) {
    throw new Error("WebUSB is unavailable. Use desktop Chrome/Edge over https:// or localhost.");
  }

  // Reconnects after the first grant skip the picker entirely.
  const granted = await manager.getDevices();
  log(
    granted.length === 1
      ? "Reusing the phone you already allowed…"
      : "Waiting for you to pick your phone in the browser's USB prompt…",
  );
  const device = granted.length === 1 ? granted[0] : await manager.requestDevice();
  if (!device) throw new Error("No device selected.");
  signal?.throwIfAborted();
  const closeOnAbort = () => {
    void device.raw.close().catch(() => undefined);
  };
  signal?.addEventListener("abort", closeOnAbort, { once: true });
  try {
    log(`Selected ${device.name} (${device.serial}).`);

    log("Handshaking — accept “Allow USB debugging?” on the phone.");
    let connection: AdbDaemonWebUsbConnection;
    try {
      connection = await device.connect();
    } catch (error) {
      if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
        throw new Error(
          "Another program is holding the phone's USB interface. The ADB server is the usual " +
            "culprit (`adb kill-server`); Android Studio, scrcpy and Phone Link do it too. " +
            "Close it, unplug/replug the phone, then retry.",
          { cause: error },
        );
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
      log(`Connected to ${adb.serial}, reading Phigros login data…`);
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
        if (timeout.aborted && !signal?.aborted)
          throw new Error(
            "Reading Phigros login data timed out. Check the USB connection and try again.",
            { cause: error },
          );
        throw error;
      } finally {
        removeAbort();
      }
      signal?.throwIfAborted();
      if (!userdata.trim()) {
        throw new Error(
          `${USERDATA} is empty or missing. Open Phigros once and log in with TapTap, ` +
            `or paste a token by hand.`,
        );
      }
      const { token, account } = parseUserdata(userdata);
      if (!token) {
        throw new Error(
          `Found ${USERDATA} (${userdata.length} bytes) but no sessionToken in it. ` +
            `Log in to TapTap in the game, or paste a token by hand.`,
        );
      }
      log(`Read ${USERDATA} (${userdata.length} bytes).`);
      log(`Logged in as ${describeAccount(account)}.`);
      log(`sessionToken: ${token.length} chars.`);
      return { token, account };
    } finally {
      await transport.close();
    }
  } finally {
    signal?.removeEventListener("abort", closeOnAbort);
    if (signal?.aborted) await device.raw.close().catch(() => undefined);
  }
}
