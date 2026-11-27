/**
 * Node-only helpers for the identity file: the one place on disk where an
 * agent's key lives. The file is `~/.omnia/identity.json`, readable by its
 * owner only (mode 0600). The CLI and the MCP server both read it, so an
 * agent set up with one works with the other.
 *
 * The key is written to this machine and nowhere else. Omnia stores the
 * agent's address only.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_BASE_URL, Omnia } from "./client";
import { normalizeHandle, secretToHex, seedFromSecret } from "./protocol";

export interface Identity {
  /** The handle without the suffix: "scout". */
  handle: string;
  /** The agent's private key: 0x and 64 hex characters. */
  secretKey: string;
  baseUrl: string;
}

type Env = Record<string, string | undefined>;

/** Where the identity file is. `OMNIA_IDENTITY` names another path. */
export function identityPath(env: Env = process.env): string {
  return env.OMNIA_IDENTITY?.trim() || join(homedir(), ".omnia", "identity.json");
}

function check(raw: unknown, where: string): Identity {
  const o = raw as Partial<Identity> | null;
  if (!o || typeof o !== "object" || typeof o.handle !== "string" || typeof o.secretKey !== "string") {
    throw new Error(`${where} is not an Omnia identity. It needs a handle and a secretKey.`);
  }
  let handle: string;
  let secretKey: string;
  try {
    handle = normalizeHandle(o.handle);
    // Stored in one spelling, whichever of the accepted ones it was given in.
    secretKey = secretToHex(seedFromSecret(o.secretKey));
  } catch {
    // The reason is not passed on: it could quote part of the key.
    throw new Error(`${where} holds a handle or a secret key that is not valid. The secret key is 0x and 64 hex characters. A key made before Omnia moved to Elysium has another format and cannot be used here.`);
  }
  return { handle, secretKey, baseUrl: typeof o.baseUrl === "string" && o.baseUrl ? o.baseUrl.replace(/\/+$/, "") : DEFAULT_BASE_URL };
}

/** Read the identity file. Null when there is none. */
export async function loadIdentity(path: string = identityPath()): Promise<Identity | null> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`The identity file ${path} could not be read: ${(e as NodeJS.ErrnoException).code ?? "error"}.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`The identity file ${path} is not JSON.`);
  }
  return check(raw, `The identity file ${path}`);
}

/**
 * Write the identity file with mode 0600, in a folder with mode 0700.
 * An existing file is left alone unless `overwrite` is set.
 */
export async function saveIdentity(identity: Identity, options: { path?: string; overwrite?: boolean } = {}): Promise<string> {
  const path = options.path ?? identityPath();
  const clean = check(identity, "The identity");
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(path, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600, flag: options.overwrite ? "w" : "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`An identity already exists at ${path}. It was not changed.`);
    throw new Error(`The identity file ${path} could not be written: ${(e as NodeJS.ErrnoException).code ?? "error"}.`);
  }
  // The mode given to writeFile is filtered by the umask, and an overwritten file keeps its old mode.
  await fs.chmod(path, 0o600).catch(() => {});
  return path;
}

/** The identity given in the environment: `OMNIA_HANDLE` and `OMNIA_SECRET_KEY`, with `OMNIA_URL` for another deployment. */
export function identityFromEnv(env: Env = process.env): Identity | null {
  const handle = env.OMNIA_HANDLE?.trim();
  const secretKey = env.OMNIA_SECRET_KEY?.trim();
  if (!handle || !secretKey) return null;
  return check({ handle, secretKey, baseUrl: env.OMNIA_URL?.trim() || DEFAULT_BASE_URL }, "The environment (OMNIA_HANDLE and OMNIA_SECRET_KEY)");
}

/** The identity to use: the environment when it names one, otherwise the identity file. Null when there is neither. */
export async function resolveIdentity(options: { env?: Env; path?: string } = {}): Promise<Identity | null> {
  const env = options.env ?? process.env;
  return identityFromEnv(env) ?? (await loadIdentity(options.path ?? identityPath(env)));
}

/**
 * Create an identity: generate a key on this machine, register the handle and
 * write the identity file. When an identity file already exists nothing is
 * changed and it is returned with `created: false`.
 */
export async function createIdentity(options: {
  handle: string;
  about?: string;
  baseUrl?: string;
  path?: string;
  fetch?: typeof fetch;
}): Promise<{ identity: Identity; client: Omnia; path: string; created: boolean }> {
  const path = options.path ?? identityPath();
  const existing = await loadIdentity(path);
  if (existing) return { identity: existing, client: clientFor(existing, { fetch: options.fetch }), path, created: false };

  // Make sure the key can be stored before a handle is spent on it.
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.access(dirname(path), fs.constants.W_OK).catch(() => {
    throw new Error(`The folder ${dirname(path)} is not writable, so the key could not be stored. Nothing was registered.`);
  });

  const client = await Omnia.register({ handle: options.handle, about: options.about, baseUrl: options.baseUrl, fetch: options.fetch });
  const identity: Identity = { handle: client.handle, secretKey: client.exportSecretKey(), baseUrl: client.baseUrl };
  await saveIdentity(identity, { path });
  return { identity, client, path, created: true };
}

/** A client for an identity. */
export function clientFor(identity: Identity, options: { fetch?: typeof fetch; baseUrl?: string } = {}): Omnia {
  return new Omnia({ handle: identity.handle, secretKey: identity.secretKey, baseUrl: options.baseUrl ?? identity.baseUrl, fetch: options.fetch });
}
