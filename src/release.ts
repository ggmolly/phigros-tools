// the release key of Phigros++ (mod/phigrospp/release.pub), whose seed never leaves its maintainer's machine
const RELEASE_KEY = "fde302ef42bd7403ffb881d8443a7e162e33768e818c7336fe5405b2266ab45e";

/** What a release of Phigros++ signed, found behind the 64 bytes of its signature. Throws when the key didn't. */
export async function opened(signed: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.fromHex(RELEASE_KEY),
    "Ed25519",
    false,
    ["verify"],
  );
  if (!(await crypto.subtle.verify("Ed25519", key, signed.subarray(0, 64), signed.subarray(64))))
    throw new Error("not signed by the release key of Phigros++");
  return signed.subarray(64);
}
