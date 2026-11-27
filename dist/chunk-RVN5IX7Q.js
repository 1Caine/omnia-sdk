// src/protocol.ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, isAddress as isHexAddress, recoverMessageAddress } from "viem";
var HANDLE_SUFFIX = "omnia";
var HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,30}[a-z0-9]$/;
var HEADER = {
  id: "x-omnia-id",
  timestamp: "x-omnia-ts",
  nonce: "x-omnia-nonce",
  signature: "x-omnia-sig",
  receipt: "x-omnia-receipt"
};
var enc = new TextEncoder();
var toHex = (bytes) => `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
var fromHex = (hex) => Uint8Array.from((hex.replace(/^0x/, "").match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
function normalizeHandle(input) {
  let h = input.trim().toLowerCase();
  if (h.startsWith("@")) h = h.slice(1);
  if (h.endsWith(`.${HANDLE_SUFFIX}`)) h = h.slice(0, -(HANDLE_SUFFIX.length + 1));
  if (!HANDLE_PATTERN.test(h)) throw new Error("A handle is 3 to 32 characters: lowercase letters, digits and single hyphens.");
  return h;
}
var displayHandle = (handle) => `${handle}.${HANDLE_SUFFIX}`;
function isAddress(value) {
  return typeof value === "string" && isHexAddress(value);
}
function normalizeAddress(value) {
  if (!isAddress(value)) throw new Error("That is not a 0x address.");
  return getAddress(value);
}
var sameAddress = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
async function sha256Hex(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomNonce(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toHex(b).slice(2);
}
async function keyFromSeed(seed) {
  if (seed.length !== 32) throw new Error("A private key is 32 bytes.");
  return { seed, address: privateKeyToAccount(toHex(seed)).address };
}
async function generateKey() {
  return keyFromSeed(fromHex(generatePrivateKey()));
}
function seedFromSecret(secret) {
  let bytes;
  if (typeof secret === "string") {
    const t = secret.trim();
    if (t.startsWith("[")) bytes = Uint8Array.from(JSON.parse(t));
    else if (/^(0x)?[0-9a-fA-F]{64}$/.test(t)) bytes = fromHex(t);
    else throw new Error("A private key is 64 hex characters, with or without 0x.");
  } else bytes = Uint8Array.from(secret);
  if (bytes.length !== 32) throw new Error("A private key is 32 bytes.");
  return bytes;
}
var secretToHex = (seed) => toHex(seed);
async function signText(seed, text) {
  return privateKeyToAccount(toHex(seed)).signMessage({ message: text });
}
async function verifyText(address, text, signature) {
  try {
    if (!isAddress(address) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
    return sameAddress(await recoverMessageAddress({ message: text, signature }), address);
  } catch {
    return false;
  }
}
function registerMessage(handle, address, timestamp) {
  return `omnia:v1:register
${handle}
${address}
${timestamp}`;
}
function requestMessage(p) {
  return `omnia:v1:request
${p.handle}
${p.method.toUpperCase()}
${p.path}
${p.bodyHash}
${p.timestamp}
${p.nonce}`;
}
async function signRequest(seed, handle, method, path, body, now = Math.floor(Date.now() / 1e3)) {
  const nonce = randomNonce();
  const bodyHash = await sha256Hex(body ?? "");
  const signature = await signText(seed, requestMessage({ handle, method, path, bodyHash, timestamp: now, nonce }));
  return {
    [HEADER.id]: displayHandle(handle),
    [HEADER.timestamp]: String(now),
    [HEADER.nonce]: nonce,
    [HEADER.signature]: signature
  };
}
async function verifyRequest(input) {
  const id = input.headers.get(HEADER.id);
  const ts = input.headers.get(HEADER.timestamp);
  const nonce = input.headers.get(HEADER.nonce);
  const sig = input.headers.get(HEADER.signature);
  if (!id || !ts || !nonce || !sig) return { ok: false, reason: "missing" };
  let handle;
  try {
    handle = normalizeHandle(id);
  } catch {
    return { ok: false, reason: "handle" };
  }
  const timestamp = Number(ts);
  const now = input.now ?? Math.floor(Date.now() / 1e3);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > (input.skewSeconds ?? 60)) return { ok: false, reason: "expired" };
  if (nonce.length < 8 || nonce.length > 64) return { ok: false, reason: "missing" };
  const address = await input.resolve(handle);
  if (!address) return { ok: false, reason: "handle" };
  const bodyHash = await sha256Hex(input.body);
  const ok = await verifyText(address, requestMessage({ handle, method: input.method, path: input.path, bodyHash, timestamp, nonce }), sig);
  return ok ? { ok: true, handle, address, nonce, timestamp } : { ok: false, reason: "signature" };
}
function ownerMessage(handle, agentAddress, ownerAddress, issuedAt) {
  return [
    `Omnia: I am the owner of the agent ${displayHandle(handle)}.`,
    `Agent address: ${agentAddress}`,
    `Owner wallet: ${ownerAddress}`,
    `Issued: ${issuedAt}`
  ].join("\n");
}
function signInMessage(c) {
  return [
    `${c.domain} wants you to sign in with your Omnia ID:`,
    displayHandle(c.handle),
    "",
    ...c.statement ? [c.statement, ""] : [],
    `Nonce: ${c.nonce}`,
    `Issued At: ${c.issuedAt}`,
    `Expiration Time: ${c.expiresAt}`
  ].join("\n");
}
async function verifySignIn(c, signature, address, expect) {
  if (c.domain !== expect.domain) return { ok: false, reason: "domain" };
  const now = (expect.now ?? /* @__PURE__ */ new Date()).getTime();
  if (!(Date.parse(c.expiresAt) > now) || Date.parse(c.issuedAt) > now + 6e4) return { ok: false, reason: "expired" };
  return await verifyText(address, signInMessage(c), signature) ? { ok: true } : { ok: false, reason: "signature" };
}
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function webhookSignature(secret, body, timestamp) {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}
async function verifyWebhook(secret, body, header, toleranceSeconds = 300, now = Math.floor(Date.now() / 1e3)) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}

export {
  HANDLE_SUFFIX,
  HANDLE_PATTERN,
  HEADER,
  normalizeHandle,
  displayHandle,
  isAddress,
  normalizeAddress,
  sameAddress,
  sha256Hex,
  randomNonce,
  keyFromSeed,
  generateKey,
  seedFromSecret,
  secretToHex,
  signText,
  verifyText,
  registerMessage,
  requestMessage,
  signRequest,
  verifyRequest,
  ownerMessage,
  signInMessage,
  verifySignIn,
  hmacHex,
  webhookSignature,
  verifyWebhook
};
