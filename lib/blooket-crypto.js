const BUILD_UUID_RE = /\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/;
const SECRET_RE = /\(new TextEncoder\)\.encode\("(.+?)"\)/;

export async function encryptBlooketPayload(payload, secret) {
  const blocks = new TextEncoder().encode(JSON.stringify(payload));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, blocks);
  const ivText = Array.from(iv, (byte) => String.fromCharCode(byte)).join("");
  const cipherText = Array.from(new Uint8Array(ciphertext), (byte) => String.fromCharCode(byte)).join("");
  return btoa(ivText + cipherText);
}

export function parseBuildConfigFromSource(source) {
  if (!source || typeof source !== "string") {
    return null;
  }
  if (!BUILD_UUID_RE.test(source) || !SECRET_RE.test(source)) {
    return null;
  }
  return {
    buildId: source.match(BUILD_UUID_RE)[0],
    secret: source.match(SECRET_RE)[1],
  };
}
