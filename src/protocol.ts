/**
 * The Omnia wire protocol: the exact strings an agent signs and how they are
 * checked. The API, the Gate middleware, the CLI and the MCP server all use
 * this file, so a signature made by one is accepted by the others.
 *
 * Keys are ed25519. An agent's public key, written in base58, is also its
 * Solana address, so the key that proves identity is the key that holds money.
 */
import * as ed from "@noble/ed25519";
import bs58 from "bs58";

export const HANDLE_SUFFIX = "omnia";
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,30}[a-z0-9]$/;

export const HEADER = {
  id: "x-omnia-id",
  timestamp: "x-omnia-ts",
  nonce: "x-omnia-nonce",
  signature: "x-omnia-sig",
  receipt: "x-omnia-receipt",
} as const;

const enc = new TextEncoder();

/** "Scout.omnia", "scout" and " scout.OMNIA " all become "scout". Throws when the handle is not valid. */
export function normalizeHandle(input: string): string {
  let h = input.trim().toLowerCase();
  if (h.startsWith("@")) h = h.slice(1);
  if (h.endsWith(`.${HANDLE_SUFFIX}`)) h = h.slice(0, -(HANDLE_SUFFIX.length + 1));
  if (!HANDLE_PATTERN.test(h)) throw new Error("A handle is 3 to 32 characters: lowercase letters, digits and single hyphens.");
  return h;
}

export const displayHandle = (handle: string): string => `${handle}.${HANDLE_SUFFIX}`;

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomNonce(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return bs58.encode(b);
}

/** A 32 byte ed25519 seed makes the key pair. Solana secret keys are 64 bytes: the seed followed by the public key. */
export async function keyFromSeed(seed: Uint8Array): Promise<{ seed: Uint8Array; publicKey: Uint8Array; address: string }> {
  if (seed.length !== 32) throw new Error("An ed25519 seed is 32 bytes.");
  const publicKey = await ed.getPublicKeyAsync(seed);
  return { seed, publicKey, address: bs58.encode(publicKey) };
}

export async function generateKey() {
  return keyFromSeed(ed.utils.randomPrivateKey());
}

/** Accepts a 64 byte Solana secret key or a 32 byte seed, as bytes, a JSON array or base58 text. */
export function seedFromSecret(secret: Uint8Array | number[] | string): Uint8Array {
  let bytes: Uint8Array;
  if (typeof secret === "string") {
    const t = secret.trim();
    bytes = t.startsWith("[") ? Uint8Array.from(JSON.parse(t) as number[]) : bs58.decode(t);
  } else bytes = Uint8Array.from(secret);
  if (bytes.length === 64) return bytes.slice(0, 32);
  if (bytes.length === 32) return bytes;
  throw new Error("A secret key is 32 or 64 bytes.");
}

export async function signText(seed: Uint8Array, text: string): Promise<string> {
  return bs58.encode(await ed.signAsync(enc.encode(text), seed));
}

export async function verifyText(address: string, text: string, signature: string): Promise<boolean> {
  try {
    const key = bs58.decode(address);
    const sig = bs58.decode(signature);
    if (key.length !== 32 || sig.length !== 64) return false;
    return await ed.verifyAsync(sig, enc.encode(text), key);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMessage(handle: string, address: string, timestamp: number): string {
  return `omnia:v1:register\n${handle}\n${address}\n${timestamp}`;
}

// ---------------------------------------------------------------------------
// Signed requests. Every call an agent makes to the API carries these headers.
// ---------------------------------------------------------------------------

export interface SignedRequestParts {
  handle: string;
  method: string;
  /** Path and query, exactly as sent: "/api/v1/inbox?since=12". */
  path: string;
  /** sha256 of the body bytes, hex. The hash of an empty body when there is none. */
  bodyHash: string;
  timestamp: number;
  nonce: string;
}

export function requestMessage(p: SignedRequestParts): string {
  return `omnia:v1:request\n${p.handle}\n${p.method.toUpperCase()}\n${p.path}\n${p.bodyHash}\n${p.timestamp}\n${p.nonce}`;
}

export async function signRequest(
  seed: Uint8Array,
  handle: string,
  method: string,
  path: string,
  body?: string | Uint8Array,
  now: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const nonce = randomNonce();
  const bodyHash = await sha256Hex(body ?? "");
  const signature = await signText(seed, requestMessage({ handle, method, path, bodyHash, timestamp: now, nonce }));
  return {
    [HEADER.id]: displayHandle(handle),
    [HEADER.timestamp]: String(now),
    [HEADER.nonce]: nonce,
    [HEADER.signature]: signature,
  };
}

export type VerifyFailure = "missing" | "handle" | "expired" | "signature";

/**
 * Check the signature headers of a request against the agent's public key.
 * The caller resolves the handle to its key and rejects a nonce it has seen before.
 */
export async function verifyRequest(input: {
  headers: { get(name: string): string | null };
  method: string;
  path: string;
  body: string | Uint8Array;
  resolve: (handle: string) => Promise<string | null>;
  skewSeconds?: number;
  now?: number;
}): Promise<{ ok: true; handle: string; address: string; nonce: string; timestamp: number } | { ok: false; reason: VerifyFailure }> {
  const id = input.headers.get(HEADER.id);
  const ts = input.headers.get(HEADER.timestamp);
  const nonce = input.headers.get(HEADER.nonce);
  const sig = input.headers.get(HEADER.signature);
  if (!id || !ts || !nonce || !sig) return { ok: false, reason: "missing" };
  let handle: string;
  try {
    handle = normalizeHandle(id);
  } catch {
    return { ok: false, reason: "handle" };
  }
  const timestamp = Number(ts);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > (input.skewSeconds ?? 60)) return { ok: false, reason: "expired" };
  if (nonce.length < 8 || nonce.length > 64) return { ok: false, reason: "missing" };
  const address = await input.resolve(handle);
  if (!address) return { ok: false, reason: "handle" };
  const bodyHash = await sha256Hex(input.body);
  const ok = await verifyText(address, requestMessage({ handle, method: input.method, path: input.path, bodyHash, timestamp, nonce }), sig);
  return ok ? { ok: true, handle, address, nonce, timestamp } : { ok: false, reason: "signature" };
}

// ---------------------------------------------------------------------------
// Owner verification. The owner's wallet signs a sentence a person can read.
// ---------------------------------------------------------------------------

export function ownerMessage(handle: string, agentAddress: string, ownerAddress: string, issuedAt: string): string {
  return [
    `Omnia: I am the owner of the agent ${displayHandle(handle)}.`,
    `Agent key: ${agentAddress}`,
    `Owner wallet: ${ownerAddress}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Sign in with Omnia. A website shows a challenge, the agent signs it.
// ---------------------------------------------------------------------------

export interface SignInChallenge {
  /** The website asking, as a host name: "example.com". */
  domain: string;
  handle: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  /** What the sign-in is for, shown to whoever reads the log. Optional. */
  statement?: string;
}

export function signInMessage(c: SignInChallenge): string {
  return [
    `${c.domain} wants you to sign in with your Omnia ID:`,
    displayHandle(c.handle),
    "",
    ...(c.statement ? [c.statement, ""] : []),
    `Nonce: ${c.nonce}`,
    `Issued At: ${c.issuedAt}`,
    `Expiration Time: ${c.expiresAt}`,
  ].join("\n");
}

export async function verifySignIn(
  c: SignInChallenge,
  signature: string,
  address: string,
  expect: { domain: string; now?: Date },
): Promise<{ ok: true } | { ok: false; reason: "domain" | "expired" | "signature" }> {
  if (c.domain !== expect.domain) return { ok: false, reason: "domain" };
  const now = (expect.now ?? new Date()).getTime();
  if (!(Date.parse(c.expiresAt) > now) || Date.parse(c.issuedAt) > now + 60_000) return { ok: false, reason: "expired" };
  return (await verifyText(address, signInMessage(c), signature)) ? { ok: true } : { ok: false, reason: "signature" };
}

// ---------------------------------------------------------------------------
// Webhooks. Omnia signs every delivery with the agent's webhook secret.
// ---------------------------------------------------------------------------

export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The value of the `x-omnia-webhook-signature` header: "t=1732300000,v1=hex". */
export async function webhookSignature(secret: string, body: string, timestamp: number): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

export async function verifyWebhook(secret: string, body: string, header: string | null, toleranceSeconds = 300, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  // Compare without leaking where the first difference is.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}
