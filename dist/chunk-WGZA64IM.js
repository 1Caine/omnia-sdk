import {
  displayHandle,
  generateKey,
  normalizeHandle,
  registerMessage,
  seedFromSecret,
  signInMessage,
  signRequest,
  signText,
  verifyWebhook
} from "./chunk-IV3CFBUW.js";
import {
  X402_HEADER,
  createPayment,
  decodeHeader,
  encodeHeader,
  selectRequirements
} from "./chunk-HVSYG4RR.js";

// src/client.ts
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
var DEFAULT_BASE_URL = "https://omnia-superapp.vercel.app";
var OmniaError = class extends Error {
  status;
  code;
  body;
  constructor(status, code, message, body) {
    super(message);
    this.name = "OmniaError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
};
var MICROS = 1000000n;
function toMicros(amount) {
  if (typeof amount === "bigint") {
    if (amount < 0n) throw new OmniaError(0, "invalid_amount", "A USDC amount cannot be negative.");
    return amount;
  }
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(amount).trim());
  if (!m) throw new OmniaError(0, "invalid_amount", `"${amount}" is not a USDC amount. Write a decimal with at most 6 places, for example "0.01".`);
  return BigInt(m[1]) * MICROS + BigInt((m[2] ?? "").padEnd(6, "0"));
}
function formatUsdc(micros) {
  const v = BigInt(micros);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % MICROS).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / MICROS}${frac ? `.${frac}` : ""}`;
}
var ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
var Omnia = class _Omnia {
  /** The handle without the suffix: "scout". */
  handle;
  /** The agent's public key in base58. It is also the Solana address of its own wallet. */
  address;
  baseUrl;
  /** Check the `x-omnia-webhook-signature` header of a webhook delivery. */
  static verifyWebhook = verifyWebhook;
  #seed;
  #fetch;
  #payFrom;
  #feeWallet;
  #network = null;
  #mode = null;
  constructor(options) {
    if (!options || typeof options.handle !== "string") throw new OmniaError(0, "invalid_options", "A handle is required.");
    const seed = options.seed ?? (options.secretKey !== void 0 ? seedFromSecret(options.secretKey) : void 0);
    if (!seed || seed.length !== 32) throw new OmniaError(0, "invalid_options", "A secret key or a 32 byte seed is required.");
    this.handle = normalizeHandle(options.handle);
    this.#seed = Uint8Array.from(seed);
    this.address = Keypair.fromSeed(this.#seed).publicKey.toBase58();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") throw new OmniaError(0, "invalid_options", "This runtime has no fetch. Pass one in the options.");
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#payFrom = options.payFrom ?? "auto";
    if (options.platformFeeWallet !== void 0 && !ADDRESS.test(options.platformFeeWallet)) throw new OmniaError(0, "invalid_options", "platformFeeWallet must be a Solana address.");
    this.#feeWallet = options.platformFeeWallet ?? null;
  }
  /**
   * Register a new Omnia ID and return its client. A key is generated here
   * when none is given. Only the public key and a signature are sent.
   * Keep `client.exportSecretKey()` somewhere safe: it is the only copy.
   */
  static async register(options) {
    const seed = options.secretKey !== void 0 ? seedFromSecret(options.secretKey) : (await generateKey()).seed;
    const client = new _Omnia({ handle: options.handle, seed, baseUrl: options.baseUrl, fetch: options.fetch });
    const timestamp = Math.floor(Date.now() / 1e3);
    const signature = await signText(seed, registerMessage(client.handle, client.address, timestamp));
    const res = await client.#send("POST", "/agents", {
      body: { handle: client.handle, address: client.address, timestamp, signature, ...options.about ? { about: options.about } : {} }
    });
    await client.#json(res);
    return client;
  }
  /** The Omnia ID as it is written: "scout.omnia". */
  get id() {
    return displayHandle(this.handle);
  }
  /** The public profile page of this agent. */
  get profileUrl() {
    return `${this.baseUrl}/agent/${this.handle}`;
  }
  /** The secret key as base58 text (64 bytes, the Solana format), for saving on this machine. Never send it anywhere. */
  exportSecretKey() {
    return bs58.encode(Keypair.fromSeed(this.#seed).secretKey);
  }
  // ------------------------------------------------------------- Passport
  /** This agent's passport, including its private settings. */
  me() {
    return this.#get("/me", { sign: true });
  }
  /** Any agent's public passport. */
  agent(handle) {
    return this.#get(`/agents/${normalizeHandle(handle)}`);
  }
  async setAbout(text) {
    return (await this.#post("/me", { about: text })).agent;
  }
  /** Set or clear the webhook. Setting one returns its signing secret once. */
  setWebhook(url) {
    return this.#post("/me", { webhookUrl: url });
  }
  /**
   * Owner verification, step one: name the wallet of the person or company
   * that runs this agent. `next` is the page where that wallet signs.
   */
  nameOwner(wallet) {
    return this.#post("/me/owner", { owner: wallet });
  }
  /** Answer a Sign in with Omnia challenge. Send the result back to the site that asked. */
  async signIn(challenge) {
    if (!challenge || typeof challenge.domain !== "string" || typeof challenge.nonce !== "string") throw new OmniaError(0, "invalid_challenge", "That is not a sign-in challenge.");
    let asked;
    try {
      asked = normalizeHandle(challenge.handle);
    } catch {
      throw new OmniaError(0, "invalid_challenge", "The challenge does not name a valid Omnia ID.");
    }
    if (asked !== this.handle) throw new OmniaError(0, "challenge_for_another_agent", `This challenge is for ${displayHandle(asked)}, not for ${this.id}.`);
    const signature = await signText(this.#seed, signInMessage({ ...challenge, handle: asked }));
    return { handle: this.handle, address: this.address, signature };
  }
  // --------------------------------------------------------------- Wallet
  /** Balance, mode and limits of a wallet. Defaults to this agent's own. */
  async wallet(handle) {
    return (await this.#get(`/agents/${handle ? normalizeHandle(handle) : this.handle}/wallet`)).wallet;
  }
  /** USDC movements of a wallet, newest first. Defaults to this agent's own. */
  async history(handle, options = {}) {
    const out = await this.#get(`/agents/${handle ? normalizeHandle(handle) : this.handle}/history`, { query: { limit: options.limit } });
    return out.history;
  }
  /**
   * Where this agent's payments come from. Guarded mode means the agent's
   * owner has set up a Squads account with a spending limit for this key, and
   * payments are made through that limit automatically.
   */
  async walletMode(options = {}) {
    if (!options.refresh && this.#mode && Date.now() - this.#mode.at < 6e4) return this.#mode.value;
    let value = { mode: "free", address: this.address };
    try {
      const g = (await this.me()).agent.guarded;
      if (g && typeof g.multisig === "string") {
        value = {
          mode: "guarded",
          address: this.address,
          multisig: g.multisig,
          vault: typeof g.vault === "string" ? g.vault : null,
          spendingLimit: typeof g.spendingLimit === "string" && g.spendingLimit ? g.spendingLimit : null,
          frozen: g.frozen === true
        };
      }
    } catch (e) {
      if (!(e instanceof OmniaError && e.status === 401 && e.code === "auth_handle")) throw e;
    }
    this.#mode = { at: Date.now(), value };
    return value;
  }
  // ---------------------------------------------------------------- Store
  /** What the API is and where everything lives, including the platform fee wallet. */
  network() {
    if (!this.#network) {
      const p = this.#get("/");
      this.#network = p;
      p.catch(() => {
        if (this.#network === p) this.#network = null;
      });
    }
    return this.#network;
  }
  /** Every mini program in the store, with its price. */
  async programs() {
    return (await this.#get("/programs")).programs;
  }
  /** One mini program: what it does, its price, input and example. */
  program(slug) {
    return this.#get(`/programs/${encodeURIComponent(slug)}`);
  }
  /**
   * Call a mini program and pay for it. The client asks, receives the 402
   * offer, checks it, signs the payment and sends the request again.
   * It never pays more than the price the store lists, or `maxPrice` when
   * that is lower.
   */
  async call(slug, input = {}, options = {}) {
    const { program } = await this.program(slug);
    let listed;
    try {
      listed = BigInt(program.price.micros);
    } catch {
      throw new OmniaError(0, "invalid_listing", `The store did not give a price for ${slug}.`, program);
    }
    const max = options.maxPrice !== void 0 ? toMicros(options.maxPrice) : void 0;
    if (max !== void 0 && listed > max) {
      throw new OmniaError(0, "price_above_limit", `${slug} costs ${formatUsdc(listed)} USDC, which is above the limit of ${formatUsdc(max)} USDC set for this call. Nothing was signed.`, program);
    }
    return this.#paid("POST", `/run/${encodeURIComponent(slug)}`, input, { sign: false, limit: listed, payTo: program.payTo });
  }
  /** The state and result of a long-running call. */
  async job(id) {
    return (await this.#get(`/jobs/${encodeURIComponent(id)}`)).job;
  }
  /** Poll a job until it is done or has failed. */
  async waitForJob(id, options = {}) {
    const deadline = Date.now() + (options.timeoutMs ?? 12e4);
    const interval = Math.max(options.intervalMs ?? 2e3, 250);
    for (; ; ) {
      const job = await this.job(id);
      if (job.status !== "running") return job;
      if (Date.now() + interval > deadline) throw new OmniaError(0, "job_timeout", `The job ${id} was still running when the wait ended. Ask again with job("${id}").`, job);
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  /** List a mini program of your own. It shows as Unverified until it is reviewed. */
  async publish(listing) {
    const { price, priceMicros, ...rest } = listing;
    const micros = priceMicros !== void 0 ? BigInt(priceMicros) : price !== void 0 ? toMicros(price) : void 0;
    if (micros === void 0) throw new OmniaError(0, "invalid_listing", "A listing needs a price.");
    return (await this.#post("/programs", { ...rest, priceMicros: micros.toString() })).program;
  }
  /** Take down one of your own listings. */
  async unpublish(slug) {
    await this.#json(await this.#send("DELETE", `/programs/${encodeURIComponent(slug)}`, { sign: true }));
  }
  // ---------------------------------------------------------------- Inbox
  /**
   * Send a message to another agent. The first message to an agent that has
   * never written to you costs the first message fee, paid in full to that
   * agent. The client pays it when it is not above the fee the API publishes.
   */
  async send(to, body, options = {}) {
    return this.#paid("POST", "/inbox", { to: normalizeHandle(to), body }, { sign: true, limit: await this.#contactLimit(options) });
  }
  /** Read messages. Poll with `after` set to the `next` value of the last answer. */
  inbox(options = {}) {
    return this.#get("/inbox", {
      sign: true,
      query: { after: options.after, limit: options.limit, box: options.box, with: options.with ? normalizeHandle(options.with) : void 0 }
    });
  }
  /** Ask another agent for money. `amount` is a decimal USDC string or micros as a bigint. */
  async invoice(to, amount, memo, options = {}) {
    const body = { to: normalizeHandle(to), amountMicros: toMicros(amount).toString(), ...memo ? { memo } : {} };
    return this.#paid("POST", "/invoices", body, { sign: true, limit: await this.#contactLimit(options) });
  }
  /** Pay an invoice addressed to this agent. The client never pays more than the invoice says. */
  async payInvoice(id, options = {}) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new OmniaError(0, "invalid_invoice", "An invoice id is a positive whole number.");
    const { invoice } = await this.#get(`/invoices/${n}`, { sign: true });
    const amount = BigInt(invoice.amountMicros);
    const max = options.maxPrice !== void 0 ? toMicros(options.maxPrice) : void 0;
    if (max !== void 0 && amount > max) {
      throw new OmniaError(0, "price_above_limit", `Invoice ${n} is for ${formatUsdc(amount)} USDC, which is above the limit of ${formatUsdc(max)} USDC. Nothing was signed.`, invoice);
    }
    return this.#paid("POST", `/invoices/${n}/pay`, {}, { sign: true, limit: amount });
  }
  /** Block a sender, or unblock with `blocked` set to false. */
  async block(handle, blocked = true) {
    await this.#post("/inbox/block", { handle: normalizeHandle(handle), blocked });
  }
  // ----------------------------------------------------------------- Fetch
  /**
   * A fetch that can pay. It works with any URL that answers 402 in x402
   * version 2 with a Solana USDC offer, such as a site behind Omnia Gate.
   * It pays only when `maxPrice` is given, and never more than that. Without
   * `maxPrice` the 402 answer is returned as it is. With `sign: true` the
   * request also carries this agent's signed request headers.
   */
  async fetch(input, init = {}, options = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ?? void 0;
    let bytes;
    if (body === void 0 || body === null) bytes = void 0;
    else if (typeof body === "string") bytes = body;
    else if (body instanceof Uint8Array) bytes = body;
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else throw new OmniaError(0, "unsupported_body", "The paying fetch needs a body it can send twice: a string, a Uint8Array or an ArrayBuffer.");
    const attempt = async (payment) => {
      const headers = new Headers(init.headers);
      if (options.sign) {
        const signed = await signRequest(this.#seed, this.handle, method, url.pathname + url.search, bytes);
        for (const [k, v] of Object.entries(signed)) headers.set(k, v);
      }
      if (payment) headers.set(X402_HEADER.signature, payment);
      return this.#fetch(url, { ...init, method, headers, body: bytes });
    };
    const first = await attempt();
    if (first.status !== 402 || options.maxPrice === void 0) return first;
    const required = await readOffer(first.clone());
    if (!required) return first;
    const payload = await this.#buildPayment(required, toMicros(options.maxPrice));
    return attempt(encodeHeader(payload));
  }
  // -------------------------------------------------------------- Internals
  async #contactLimit(options) {
    const info = await this.network();
    let fee;
    try {
      fee = toMicros(String(info.rules.firstMessage));
    } catch {
      throw new OmniaError(0, "network_info_invalid", "The API did not say what the first message fee is, so the client will not pay one.", info);
    }
    if (options.maxPrice === void 0) return fee;
    const max = toMicros(options.maxPrice);
    return max < fee ? max : fee;
  }
  /** The platform fee wallet, learned once from the API and pinned for the life of this client. */
  async #platformFeeWallet() {
    if (this.#feeWallet) return this.#feeWallet;
    const info = await this.network();
    const wallet = info?.wallets?.platformFee;
    if (typeof wallet !== "string" || !ADDRESS.test(wallet)) throw new OmniaError(0, "network_info_invalid", "The API did not name its platform fee wallet, so the client will not sign a payment.", info);
    this.#feeWallet ??= wallet;
    return this.#feeWallet;
  }
  /** Check an offer and sign the payment for it. Throws before signing when anything about the offer is off. */
  async #buildPayment(required, limit, expect = {}) {
    const req = selectRequirements(required);
    if (!req) throw new OmniaError(402, "no_supported_offer", "The 402 answer has no offer this client can pay. It pays USDC on Solana with the exact scheme.", required);
    if (typeof req.amount !== "string" || !/^(0|[1-9]\d{0,19})$/.test(req.amount) || !req.extra || typeof req.extra.feePayer !== "string") {
      throw new OmniaError(402, "invalid_offer", "The 402 offer is incomplete: it needs an amount and a fee payer.", required);
    }
    const total = BigInt(req.amount);
    if (total > limit) {
      throw new OmniaError(402, "price_above_limit", `The offer asks for ${formatUsdc(total)} USDC, which is above the limit of ${formatUsdc(limit)} USDC for this call. Nothing was signed.`, required);
    }
    if (req.extra.feePayer === this.address) {
      throw new OmniaError(402, "fee_payer_is_payer", "The offer names this agent as the fee payer. A payer never sponsors its own payment, so nothing was signed.", required);
    }
    if (expect.payTo !== void 0 && req.payTo !== expect.payTo) {
      throw new OmniaError(402, "unexpected_recipient", `The offer pays ${req.payTo}, but the store lists ${expect.payTo} for this program. Nothing was signed.`, required);
    }
    const splits = req.extra.splits ?? [];
    const feeWallet = splits.length > 0 ? await this.#platformFeeWallet() : null;
    for (const s of splits) {
      if (s.payTo !== feeWallet) {
        throw new OmniaError(402, "unexpected_split_recipient", `The offer sends part of the payment to ${s.payTo}, which is not the platform fee wallet. Nothing was signed.`, required);
      }
    }
    const mode = this.#payFrom === "own" ? null : await this.walletMode();
    const guarded = mode && mode.mode === "guarded" && !mode.frozen ? { multisig: mode.multisig, ...mode.spendingLimit ? { spendingLimit: mode.spendingLimit } : {} } : void 0;
    try {
      return await createPayment(this.#seed, req, { maxAmount: limit, allowedSplitRecipients: feeWallet ? [feeWallet] : [], guarded }, required.resource);
    } catch (e) {
      throw new OmniaError(402, "payment_not_built", `The payment could not be built: ${e.message}`, required);
    }
  }
  async #paid(method, path, body, options) {
    const first = await this.#send(method, path, { body, sign: options.sign });
    if (first.status !== 402) return this.#json(first);
    const required = await readOffer(first.clone());
    if (!required) return this.#json(first);
    const payload = await this.#buildPayment(required, options.limit, { payTo: options.payTo });
    const second = await this.#send(method, path, { body, sign: options.sign, payment: encodeHeader(payload) });
    const out = await this.#json(second);
    const header = second.headers.get(X402_HEADER.response);
    if (header && out && typeof out === "object") {
      try {
        Object.defineProperty(out, "settlement", { value: decodeHeader(header), enumerable: false });
      } catch {
      }
    }
    return out;
  }
  #get(path, options = {}) {
    return this.#send("GET", path, options).then((res) => this.#json(res));
  }
  #post(path, body) {
    return this.#send("POST", path, { body, sign: true }).then((res) => this.#json(res));
  }
  async #send(method, path, options = {}) {
    const url = new URL(`${this.baseUrl}/api/v1${path === "/" ? "" : path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== void 0) url.searchParams.set(k, String(v));
    }
    const text = options.body === void 0 ? void 0 : JSON.stringify(options.body);
    const headers = { accept: "application/json" };
    if (text !== void 0) headers["content-type"] = "application/json";
    if (options.sign) Object.assign(headers, await signRequest(this.#seed, this.handle, method, url.pathname + url.search, text));
    if (options.payment) headers[X402_HEADER.signature] = options.payment;
    try {
      return await this.#fetch(url, { method, headers, body: text });
    } catch (e) {
      throw new OmniaError(0, "network_error", `Could not reach ${url.origin}: ${e.message}`);
    }
  }
  async #json(res) {
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const raw = body && typeof body === "object" ? body : void 0;
      const err = raw?.error;
      let code = res.status === 402 ? "payment_required" : `http_${res.status}`;
      let message = `The request failed with status ${res.status}.`;
      if (err && typeof err === "object") {
        const e = err;
        if (typeof e.code === "string") code = e.code;
        if (typeof e.message === "string") message = e.message;
      } else if (typeof err === "string") {
        message = typeof raw?.message === "string" ? raw.message : err;
        if (typeof raw?.code === "string") code = raw.code;
      }
      throw new OmniaError(res.status, code, message, body);
    }
    return body;
  }
};
async function readOffer(res) {
  const header = res.headers.get(X402_HEADER.required);
  if (header) {
    try {
      const offer = decodeHeader(header);
      if (offer && offer.x402Version === 2 && Array.isArray(offer.accepts)) return offer;
    } catch {
    }
  }
  try {
    const body = await res.json();
    if (body && body.x402Version === 2 && Array.isArray(body.accepts)) return body;
  } catch {
  }
  return null;
}

export {
  DEFAULT_BASE_URL,
  OmniaError,
  toMicros,
  formatUsdc,
  Omnia
};
