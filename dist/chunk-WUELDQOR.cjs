"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { newObj[key] = obj[key]; } } } newObj.default = obj; return newObj; } } function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; } function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } }// src/protocol.ts
var _ed25519 = require('@noble/ed25519'); var ed = _interopRequireWildcard(_ed25519);
var _bs58 = require('bs58'); var _bs582 = _interopRequireDefault(_bs58);
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
function normalizeHandle(input) {
  let h = input.trim().toLowerCase();
  if (h.startsWith("@")) h = h.slice(1);
  if (h.endsWith(`.${HANDLE_SUFFIX}`)) h = h.slice(0, -(HANDLE_SUFFIX.length + 1));
  if (!HANDLE_PATTERN.test(h)) throw new Error("A handle is 3 to 32 characters: lowercase letters, digits and single hyphens.");
  return h;
}
var displayHandle = (handle) => `${handle}.${HANDLE_SUFFIX}`;
async function sha256Hex(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomNonce(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return _bs582.default.encode(b);
}
async function keyFromSeed(seed) {
  if (seed.length !== 32) throw new Error("An ed25519 seed is 32 bytes.");
  const publicKey = await ed.getPublicKeyAsync(seed);
  return { seed, publicKey, address: _bs582.default.encode(publicKey) };
}
async function generateKey() {
  return keyFromSeed(ed.utils.randomPrivateKey());
}
function seedFromSecret(secret) {
  let bytes;
  if (typeof secret === "string") {
    const t = secret.trim();
    bytes = t.startsWith("[") ? Uint8Array.from(JSON.parse(t)) : _bs582.default.decode(t);
  } else bytes = Uint8Array.from(secret);
  if (bytes.length === 64) return bytes.slice(0, 32);
  if (bytes.length === 32) return bytes;
  throw new Error("A secret key is 32 or 64 bytes.");
}
async function signText(seed, text) {
  return _bs582.default.encode(await ed.signAsync(enc.encode(text), seed));
}
async function verifyText(address, text, signature) {
  try {
    const key = _bs582.default.decode(address);
    const sig = _bs582.default.decode(signature);
    if (key.length !== 32 || sig.length !== 64) return false;
    return await ed.verifyAsync(sig, enc.encode(text), key);
  } catch (e) {
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
  const bodyHash = await sha256Hex(_nullishCoalesce(body, () => ( "")));
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
  } catch (e2) {
    return { ok: false, reason: "handle" };
  }
  const timestamp = Number(ts);
  const now = _nullishCoalesce(input.now, () => ( Math.floor(Date.now() / 1e3)));
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > (_nullishCoalesce(input.skewSeconds, () => ( 60)))) return { ok: false, reason: "expired" };
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
    `Agent key: ${agentAddress}`,
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
  const now = (_nullishCoalesce(expect.now, () => ( /* @__PURE__ */ new Date()))).getTime();
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
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(_nullishCoalesce(header, () => ( "")));
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}
























exports.HANDLE_SUFFIX = HANDLE_SUFFIX; exports.HANDLE_PATTERN = HANDLE_PATTERN; exports.HEADER = HEADER; exports.normalizeHandle = normalizeHandle; exports.displayHandle = displayHandle; exports.sha256Hex = sha256Hex; exports.randomNonce = randomNonce; exports.keyFromSeed = keyFromSeed; exports.generateKey = generateKey; exports.seedFromSecret = seedFromSecret; exports.signText = signText; exports.verifyText = verifyText; exports.registerMessage = registerMessage; exports.requestMessage = requestMessage; exports.signRequest = signRequest; exports.verifyRequest = verifyRequest; exports.ownerMessage = ownerMessage; exports.signInMessage = signInMessage; exports.verifySignIn = verifySignIn; exports.hmacHex = hmacHex; exports.webhookSignature = webhookSignature; exports.verifyWebhook = verifyWebhook;
