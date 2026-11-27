import {
  DEFAULT_BASE_URL,
  Omnia
} from "./chunk-FIM4CRTV.js";
import {
  normalizeHandle,
  secretToHex,
  seedFromSecret
} from "./chunk-RVN5IX7Q.js";
import "./chunk-JIOEUJZV.js";
import "./chunk-JDAFQGL2.js";

// src/node.ts
import { promises as fs } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
function identityPath(env = process.env) {
  return env.OMNIA_IDENTITY?.trim() || join(homedir(), ".omnia", "identity.json");
}
function check(raw, where) {
  const o = raw;
  if (!o || typeof o !== "object" || typeof o.handle !== "string" || typeof o.secretKey !== "string") {
    throw new Error(`${where} is not an Omnia identity. It needs a handle and a secretKey.`);
  }
  let handle;
  let secretKey;
  try {
    handle = normalizeHandle(o.handle);
    secretKey = secretToHex(seedFromSecret(o.secretKey));
  } catch {
    throw new Error(`${where} holds a handle or a secret key that is not valid. The secret key is 0x and 64 hex characters. A key made before Omnia moved to Elysium has another format and cannot be used here.`);
  }
  return { handle, secretKey, baseUrl: typeof o.baseUrl === "string" && o.baseUrl ? o.baseUrl.replace(/\/+$/, "") : DEFAULT_BASE_URL };
}
async function loadIdentity(path = identityPath()) {
  let text;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Error(`The identity file ${path} could not be read: ${e.code ?? "error"}.`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`The identity file ${path} is not JSON.`);
  }
  return check(raw, `The identity file ${path}`);
}
async function saveIdentity(identity, options = {}) {
  const path = options.path ?? identityPath();
  const clean = check(identity, "The identity");
  await fs.mkdir(dirname(path), { recursive: true, mode: 448 });
  try {
    await fs.writeFile(path, `${JSON.stringify(clean, null, 2)}
`, { mode: 384, flag: options.overwrite ? "w" : "wx" });
  } catch (e) {
    if (e.code === "EEXIST") throw new Error(`An identity already exists at ${path}. It was not changed.`);
    throw new Error(`The identity file ${path} could not be written: ${e.code ?? "error"}.`);
  }
  await fs.chmod(path, 384).catch(() => {
  });
  return path;
}
function identityFromEnv(env = process.env) {
  const handle = env.OMNIA_HANDLE?.trim();
  const secretKey = env.OMNIA_SECRET_KEY?.trim();
  if (!handle || !secretKey) return null;
  return check({ handle, secretKey, baseUrl: env.OMNIA_URL?.trim() || DEFAULT_BASE_URL }, "The environment (OMNIA_HANDLE and OMNIA_SECRET_KEY)");
}
async function resolveIdentity(options = {}) {
  const env = options.env ?? process.env;
  return identityFromEnv(env) ?? await loadIdentity(options.path ?? identityPath(env));
}
async function createIdentity(options) {
  const path = options.path ?? identityPath();
  const existing = await loadIdentity(path);
  if (existing) return { identity: existing, client: clientFor(existing, { fetch: options.fetch }), path, created: false };
  await fs.mkdir(dirname(path), { recursive: true, mode: 448 });
  await fs.access(dirname(path), fs.constants.W_OK).catch(() => {
    throw new Error(`The folder ${dirname(path)} is not writable, so the key could not be stored. Nothing was registered.`);
  });
  const client = await Omnia.register({ handle: options.handle, about: options.about, baseUrl: options.baseUrl, fetch: options.fetch });
  const identity = { handle: client.handle, secretKey: client.exportSecretKey(), baseUrl: client.baseUrl };
  await saveIdentity(identity, { path });
  return { identity, client, path, created: true };
}
function clientFor(identity, options = {}) {
  return new Omnia({ handle: identity.handle, secretKey: identity.secretKey, baseUrl: options.baseUrl ?? identity.baseUrl, fetch: options.fetch });
}
export {
  clientFor,
  createIdentity,
  identityFromEnv,
  identityPath,
  loadIdentity,
  resolveIdentity,
  saveIdentity
};
