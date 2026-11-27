"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } async function _asyncNullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return await rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }


var _chunk6SBF4BWOcjs = require('./chunk-6SBF4BWO.cjs');




var _chunkUTTT7ULNcjs = require('./chunk-UTTT7ULN.cjs');
require('./chunk-FFVSGRBM.cjs');
require('./chunk-MZORSJ6P.cjs');

// src/node.ts
var _fs = require('fs');
var _os = require('os');
var _path = require('path');
function identityPath(env = process.env) {
  return _optionalChain([env, 'access', _ => _.OMNIA_IDENTITY, 'optionalAccess', _2 => _2.trim, 'call', _3 => _3()]) || _path.join.call(void 0, _os.homedir.call(void 0, ), ".omnia", "identity.json");
}
function check(raw, where) {
  const o = raw;
  if (!o || typeof o !== "object" || typeof o.handle !== "string" || typeof o.secretKey !== "string") {
    throw new Error(`${where} is not an Omnia identity. It needs a handle and a secretKey.`);
  }
  let handle;
  let secretKey;
  try {
    handle = _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, o.handle);
    secretKey = _chunkUTTT7ULNcjs.secretToHex.call(void 0, _chunkUTTT7ULNcjs.seedFromSecret.call(void 0, o.secretKey));
  } catch (e2) {
    throw new Error(`${where} holds a handle or a secret key that is not valid. The secret key is 0x and 64 hex characters. A key made before Omnia moved to Elysium has another format and cannot be used here.`);
  }
  return { handle, secretKey, baseUrl: typeof o.baseUrl === "string" && o.baseUrl ? o.baseUrl.replace(/\/+$/, "") : _chunk6SBF4BWOcjs.DEFAULT_BASE_URL };
}
async function loadIdentity(path = identityPath()) {
  let text;
  try {
    text = await _fs.promises.readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Error(`The identity file ${path} could not be read: ${_nullishCoalesce(e.code, () => ( "error"))}.`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e3) {
    throw new Error(`The identity file ${path} is not JSON.`);
  }
  return check(raw, `The identity file ${path}`);
}
async function saveIdentity(identity, options = {}) {
  const path = _nullishCoalesce(options.path, () => ( identityPath()));
  const clean = check(identity, "The identity");
  await _fs.promises.mkdir(_path.dirname.call(void 0, path), { recursive: true, mode: 448 });
  try {
    await _fs.promises.writeFile(path, `${JSON.stringify(clean, null, 2)}
`, { mode: 384, flag: options.overwrite ? "w" : "wx" });
  } catch (e) {
    if (e.code === "EEXIST") throw new Error(`An identity already exists at ${path}. It was not changed.`);
    throw new Error(`The identity file ${path} could not be written: ${_nullishCoalesce(e.code, () => ( "error"))}.`);
  }
  await _fs.promises.chmod(path, 384).catch(() => {
  });
  return path;
}
function identityFromEnv(env = process.env) {
  const handle = _optionalChain([env, 'access', _4 => _4.OMNIA_HANDLE, 'optionalAccess', _5 => _5.trim, 'call', _6 => _6()]);
  const secretKey = _optionalChain([env, 'access', _7 => _7.OMNIA_SECRET_KEY, 'optionalAccess', _8 => _8.trim, 'call', _9 => _9()]);
  if (!handle || !secretKey) return null;
  return check({ handle, secretKey, baseUrl: _optionalChain([env, 'access', _10 => _10.OMNIA_URL, 'optionalAccess', _11 => _11.trim, 'call', _12 => _12()]) || _chunk6SBF4BWOcjs.DEFAULT_BASE_URL }, "The environment (OMNIA_HANDLE and OMNIA_SECRET_KEY)");
}
async function resolveIdentity(options = {}) {
  const env = _nullishCoalesce(options.env, () => ( process.env));
  return await _asyncNullishCoalesce(identityFromEnv(env), async () => ( await loadIdentity(_nullishCoalesce(options.path, () => ( identityPath(env))))));
}
async function createIdentity(options) {
  const path = _nullishCoalesce(options.path, () => ( identityPath()));
  const existing = await loadIdentity(path);
  if (existing) return { identity: existing, client: clientFor(existing, { fetch: options.fetch }), path, created: false };
  await _fs.promises.mkdir(_path.dirname.call(void 0, path), { recursive: true, mode: 448 });
  await _fs.promises.access(_path.dirname.call(void 0, path), _fs.promises.constants.W_OK).catch(() => {
    throw new Error(`The folder ${_path.dirname.call(void 0, path)} is not writable, so the key could not be stored. Nothing was registered.`);
  });
  const client = await _chunk6SBF4BWOcjs.Omnia.register({ handle: options.handle, about: options.about, baseUrl: options.baseUrl, fetch: options.fetch });
  const identity = { handle: client.handle, secretKey: client.exportSecretKey(), baseUrl: client.baseUrl };
  await saveIdentity(identity, { path });
  return { identity, client, path, created: true };
}
function clientFor(identity, options = {}) {
  return new (0, _chunk6SBF4BWOcjs.Omnia)({ handle: identity.handle, secretKey: identity.secretKey, baseUrl: _nullishCoalesce(options.baseUrl, () => ( identity.baseUrl)), fetch: options.fetch });
}








exports.clientFor = clientFor; exports.createIdentity = createIdentity; exports.identityFromEnv = identityFromEnv; exports.identityPath = identityPath; exports.loadIdentity = loadIdentity; exports.resolveIdentity = resolveIdentity; exports.saveIdentity = saveIdentity;
