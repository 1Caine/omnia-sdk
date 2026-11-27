"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; } var _class;













var _chunkUTTT7ULNcjs = require('./chunk-UTTT7ULN.cjs');


var _chunkFFVSGRBMcjs = require('./chunk-FFVSGRBM.cjs');








var _chunkMZORSJ6Pcjs = require('./chunk-MZORSJ6P.cjs');

// src/client.ts
var _accounts = require('viem/accounts');
var DEFAULT_BASE_URL = "https://omniasuper.app";
var OMNIA_CONTRACTS = {
  splitter: "0x0cea55aa3049700B5EB45FDf6b4D474811aB5734",
  guard: "0x969a62E7D47E526B515B461a8e6A8745987a9e59"
};
var explorerTx = (hash) => `https://elysium.kinetiq.xyz/tx/${hash}`;
var explorerAddress = (address) => `https://elysium.kinetiq.xyz/address/${address}`;
var OmniaError = class extends Error {
  
  
  
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
  return BigInt(m[1]) * MICROS + BigInt((_nullishCoalesce(m[2], () => ( ""))).padEnd(6, "0"));
}
function formatUsdc(micros) {
  const v = BigInt(micros);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % MICROS).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / MICROS}${frac ? `.${frac}` : ""}`;
}
function formatHype(wei, places = 6) {
  const unit = 10n ** BigInt(places);
  const cut = BigInt(wei) / 10n ** BigInt(18 - places);
  const frac = (cut % unit).toString().padStart(places, "0").replace(/0+$/, "");
  return `${cut / unit}${frac ? `.${frac}` : ""}`;
}
var Omnia = (_class = class _Omnia {
  /** The handle without the suffix: "scout". */
  
  /** The agent's 0x address on Elysium, derived from its key. It is the address of its own wallet. */
  
  
  /** Check the `x-omnia-webhook-signature` header of a webhook delivery. */
  static __initStatic() {this.verifyWebhook = _chunkUTTT7ULNcjs.verifyWebhook}
  #seed;
  #fetch;
  #payFrom;
  #networkFee;
  #contracts;
  /** Unix milliseconds until which the relayer has said it will not sponsor this agent. */
  #selfPayUntil = 0;
  #feeWallet;
  #network = null;
  #mode = null;
  constructor(options) {
    if (!options || typeof options.handle !== "string") throw new OmniaError(0, "invalid_options", "A handle is required.");
    const seed = _nullishCoalesce(options.seed, () => ( (options.secretKey !== void 0 ? _chunkUTTT7ULNcjs.seedFromSecret.call(void 0, options.secretKey) : void 0)));
    if (!seed || seed.length !== 32) throw new OmniaError(0, "invalid_options", "A secret key of 32 bytes is required.");
    this.handle = _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, options.handle);
    this.#seed = Uint8Array.from(seed);
    this.address = _accounts.privateKeyToAccount.call(void 0, _chunkUTTT7ULNcjs.secretToHex.call(void 0, this.#seed)).address;
    this.baseUrl = (_nullishCoalesce(options.baseUrl, () => ( DEFAULT_BASE_URL))).replace(/\/+$/, "");
    const f = _nullishCoalesce(options.fetch, () => ( globalThis.fetch));
    if (typeof f !== "function") throw new OmniaError(0, "invalid_options", "This runtime has no fetch. Pass one in the options.");
    this.#fetch = _nullishCoalesce(options.fetch, () => ( ((input, init) => globalThis.fetch(input, init))));
    this.#payFrom = _nullishCoalesce(options.payFrom, () => ( "auto"));
    if (options.networkFee !== void 0 && !["auto", "sponsored", "self"].includes(options.networkFee)) throw new OmniaError(0, "invalid_options", 'networkFee must be "auto", "sponsored" or "self".');
    this.#networkFee = _nullishCoalesce(options.networkFee, () => ( "auto"));
    if (options.platformFeeWallet !== void 0 && !_chunkUTTT7ULNcjs.isAddress.call(void 0, options.platformFeeWallet)) throw new OmniaError(0, "invalid_options", "platformFeeWallet must be a 0x address.");
    this.#feeWallet = options.platformFeeWallet !== void 0 ? _chunkUTTT7ULNcjs.normalizeAddress.call(void 0, options.platformFeeWallet) : null;
    const splitter = _nullishCoalesce(_optionalChain([options, 'access', _ => _.contracts, 'optionalAccess', _2 => _2.splitter]), () => ( OMNIA_CONTRACTS.splitter));
    const guard = _nullishCoalesce(_optionalChain([options, 'access', _3 => _3.contracts, 'optionalAccess', _4 => _4.guard]), () => ( OMNIA_CONTRACTS.guard));
    if (!_chunkUTTT7ULNcjs.isAddress.call(void 0, splitter) || !_chunkUTTT7ULNcjs.isAddress.call(void 0, guard)) throw new OmniaError(0, "invalid_options", "contracts.splitter and contracts.guard must be 0x addresses.");
    this.#contracts = { splitter: _chunkUTTT7ULNcjs.normalizeAddress.call(void 0, splitter), guard: _chunkUTTT7ULNcjs.normalizeAddress.call(void 0, guard) };
  }
  /**
   * Register a new Omnia ID and return its client. A key is generated here
   * when none is given. Only the address and a signature are sent.
   * Keep `client.exportSecretKey()` somewhere safe: it is the only copy.
   */
  static async register(options) {
    const seed = options.secretKey !== void 0 ? _chunkUTTT7ULNcjs.seedFromSecret.call(void 0, options.secretKey) : (await _chunkUTTT7ULNcjs.generateKey.call(void 0, )).seed;
    const client = new _Omnia({ handle: options.handle, seed, baseUrl: options.baseUrl, fetch: options.fetch });
    const timestamp = Math.floor(Date.now() / 1e3);
    const signature = await _chunkUTTT7ULNcjs.signText.call(void 0, seed, _chunkUTTT7ULNcjs.registerMessage.call(void 0, client.handle, client.address, timestamp));
    const res = await client.#send("POST", "/agents", {
      body: { handle: client.handle, address: client.address, timestamp, signature, ...options.about ? { about: options.about } : {} }
    });
    await client.#json(res);
    return client;
  }
  /** The Omnia ID as it is written: "scout.omnia". */
  get id() {
    return _chunkUTTT7ULNcjs.displayHandle.call(void 0, this.handle);
  }
  /** The public profile page of this agent. */
  get profileUrl() {
    return `${this.baseUrl}/agent/${this.handle}`;
  }
  /** The private key as 0x and 64 hex characters, for saving on this machine. Never send it anywhere. */
  exportSecretKey() {
    return _chunkUTTT7ULNcjs.secretToHex.call(void 0, this.#seed);
  }
  // ------------------------------------------------------------- Passport
  /** This agent's passport, including its private settings. */
  me() {
    return this.#get("/me", { sign: true });
  }
  /** Any agent's public passport. */
  agent(handle) {
    return this.#get(`/agents/${_chunkUTTT7ULNcjs.normalizeHandle.call(void 0, handle)}`);
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
      asked = _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, challenge.handle);
    } catch (e2) {
      throw new OmniaError(0, "invalid_challenge", "The challenge does not name a valid Omnia ID.");
    }
    if (asked !== this.handle) throw new OmniaError(0, "challenge_for_another_agent", `This challenge is for ${_chunkUTTT7ULNcjs.displayHandle.call(void 0, asked)}, not for ${this.id}.`);
    const signature = await _chunkUTTT7ULNcjs.signText.call(void 0, this.#seed, _chunkUTTT7ULNcjs.signInMessage.call(void 0, { ...challenge, handle: asked }));
    return { handle: this.handle, address: this.address, signature };
  }
  // --------------------------------------------------------------- Wallet
  /** Balance, mode and limits of a wallet. Defaults to this agent's own. */
  async wallet(handle) {
    return (await this.#get(`/agents/${handle ? _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, handle) : this.handle}/wallet`)).wallet;
  }
  /** USDC movements of a wallet, newest first. Defaults to this agent's own. */
  async history(handle, options = {}) {
    const out = await this.#get(`/agents/${handle ? _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, handle) : this.handle}/history`, { query: { limit: options.limit } });
    return out.history;
  }
  /**
   * Where this agent's payments come from. Guarded mode means the agent's
   * owner has put its money in a Safe and given this key limits that are
   * enforced on chain. Payments are then made from the Safe automatically.
   */
  async walletMode(options = {}) {
    if (!options.refresh && this.#mode && Date.now() - this.#mode.at < 6e4) return this.#mode.value;
    let value = { mode: "free", address: this.address };
    try {
      const g = (await this.me()).agent.guarded;
      if (g && _chunkUTTT7ULNcjs.isAddress.call(void 0, g.safe)) value = { mode: "guarded", address: this.address, safe: _chunkUTTT7ULNcjs.normalizeAddress.call(void 0, g.safe), frozen: g.frozen === true };
    } catch (e) {
      if (!(e instanceof OmniaError && e.status === 401 && e.code === "auth_handle")) throw e;
    }
    this.#mode = { at: Date.now(), value };
    return value;
  }
  /**
   * What a payment costs in gas when this agent submits it itself, and the HYPE the agent holds. Only needed
   * once the relayer has stopped sponsoring: the client asks for it on its own before it signs such a payment.
   */
  async gas() {
    const t = await this.#get("/gas", { query: { address: this.address } });
    const whole = (v) => typeof v === "string" && /^\d{1,78}$/.test(v);
    if (!t || !Number.isInteger(t.nonce) || t.nonce < 0 || !whole(t.gas) || !whole(t.maxFeePerGas) || !whole(t.maxPriorityFeePerGas) || !whole(t.balanceWei)) {
      throw new OmniaError(0, "network_info_invalid", "The API did not say what a self-paid payment needs, so the client will not sign one.", t);
    }
    return t;
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
    } catch (e3) {
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
    const deadline = Date.now() + (_nullishCoalesce(options.timeoutMs, () => ( 12e4)));
    const interval = Math.max(_nullishCoalesce(options.intervalMs, () => ( 2e3)), 250);
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
    return this.#paid("POST", "/inbox", { to: _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, to), body }, { sign: true, limit: await this.#contactLimit(options) });
  }
  /** Read messages. Poll with `after` set to the `next` value of the last answer. */
  inbox(options = {}) {
    return this.#get("/inbox", {
      sign: true,
      query: { after: options.after, limit: options.limit, box: options.box, with: options.with ? _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, options.with) : void 0 }
    });
  }
  /** Ask another agent for money. `amount` is a decimal USDC string or micros as a bigint. */
  async invoice(to, amount, memo, options = {}) {
    const body = { to: _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, to), amountMicros: toMicros(amount).toString(), ...memo ? { memo } : {} };
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
    await this.#post("/inbox/block", { handle: _chunkUTTT7ULNcjs.normalizeHandle.call(void 0, handle), blocked });
  }
  // ----------------------------------------------------------------- Fetch
  /**
   * A fetch that can pay. It works with any URL that answers 402 in x402
   * version 2 with an Omnia offer in USDC on Elysium, such as a site behind
   * Omnia Gate.
   * It pays only when `maxPrice` is given, and never more than that. Without
   * `maxPrice` the 402 answer is returned as it is. With `sign: true` the
   * request also carries this agent's signed request headers.
   */
  async fetch(input, init = {}, options = {}) {
    const url = new URL(String(input));
    const method = (_nullishCoalesce(init.method, () => ( "GET"))).toUpperCase();
    const body = _nullishCoalesce(init.body, () => ( void 0));
    let bytes;
    if (body === void 0 || body === null) bytes = void 0;
    else if (typeof body === "string") bytes = body;
    else if (body instanceof Uint8Array) bytes = body;
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else throw new OmniaError(0, "unsupported_body", "The paying fetch needs a body it can send twice: a string, a Uint8Array or an ArrayBuffer.");
    const attempt = async (payment) => {
      const headers = new Headers(init.headers);
      if (options.sign) {
        const signed = await _chunkUTTT7ULNcjs.signRequest.call(void 0, this.#seed, this.handle, method, url.pathname + url.search, bytes);
        for (const [k, v] of Object.entries(signed)) headers.set(k, v);
      }
      if (payment) headers.set(_chunkMZORSJ6Pcjs.X402_HEADER.signature, payment);
      return this.#fetch(url, { ...init, method, headers, body: bytes });
    };
    const first = await attempt();
    if (first.status !== 402 || options.maxPrice === void 0) return first;
    const required = await readOffer(first.clone());
    if (!required) return first;
    return this.#pay(await this.#checkOffer(required, toMicros(options.maxPrice)), attempt);
  }
  // -------------------------------------------------------------- Internals
  async #contactLimit(options) {
    const info = await this.network();
    let fee;
    try {
      fee = toMicros(String(info.rules.firstMessage));
    } catch (e4) {
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
    const wallet = _optionalChain([info, 'optionalAccess', _5 => _5.wallets, 'optionalAccess', _6 => _6.platformFee]);
    if (!_chunkUTTT7ULNcjs.isAddress.call(void 0, wallet)) throw new OmniaError(0, "network_info_invalid", "The API did not name its platform fee wallet, so the client will not sign a payment.", info);
    this.#feeWallet ??= _chunkUTTT7ULNcjs.normalizeAddress.call(void 0, wallet);
    return this.#feeWallet;
  }
  /** Check an offer. Throws before anything is signed when something about the offer is off. */
  async #checkOffer(required, limit, expect = {}) {
    const req = _chunkMZORSJ6Pcjs.selectRequirements.call(void 0, required);
    if (!req) throw new OmniaError(402, "no_supported_offer", "The 402 answer has no offer this client can pay. It pays USDC on Elysium with the exact scheme.", required);
    if (typeof req.amount !== "string" || !/^(0|[1-9]\d{0,19})$/.test(req.amount) || !_chunkUTTT7ULNcjs.isAddress.call(void 0, req.payTo) || !req.extra || typeof req.extra !== "object") {
      throw new OmniaError(402, "invalid_offer", "The 402 offer is incomplete: it needs an amount, a recipient and the settling contract.", required);
    }
    const total = BigInt(req.amount);
    if (total > limit) {
      throw new OmniaError(402, "price_above_limit", `The offer asks for ${formatUsdc(total)} USDC, which is above the limit of ${formatUsdc(limit)} USDC for this call. Nothing was signed.`, required);
    }
    if (expect.payTo !== void 0 && !_chunkUTTT7ULNcjs.sameAddress.call(void 0, req.payTo, expect.payTo)) {
      throw new OmniaError(402, "unexpected_recipient", `The offer pays ${req.payTo}, but the store lists ${expect.payTo} for this program. Nothing was signed.`, required);
    }
    const splits = _nullishCoalesce(req.extra.splits, () => ( []));
    const feeWallet = splits.length > 0 ? await this.#platformFeeWallet() : null;
    for (const s of splits) {
      if (!_chunkUTTT7ULNcjs.sameAddress.call(void 0, s.payTo, feeWallet)) {
        throw new OmniaError(402, "unexpected_split_recipient", `The offer sends part of the payment to ${s.payTo}, which is not the platform fee wallet. Nothing was signed.`, required);
      }
    }
    const mode = this.#payFrom === "own" ? null : await this.walletMode();
    const safe = mode && mode.mode === "guarded" && !mode.frozen ? mode.safe : null;
    const named = safe ? req.extra.guard : req.extra.splitter;
    const pinned = safe ? this.#contracts.guard : this.#contracts.splitter;
    if (!_chunkUTTT7ULNcjs.sameAddress.call(void 0, typeof named === "string" ? named : null, pinned)) {
      throw new OmniaError(402, "unexpected_contract", `The offer settles through ${String(named)}, which is not the Omnia ${safe ? "guard" : "splitter"} this client knows (${pinned}). Nothing was signed.`, required);
    }
    return { required, req, limit, feeWallet, safe };
  }
  /**
   * Sign the payment for a checked offer. `permitNonce` adds the one-time approval of the splitter. `selfPaid`
   * adds the transaction that submits the payment, signed by this agent, which then pays its own gas.
   */
  async #sign(offer, options) {
    let payload;
    try {
      payload = await _chunkMZORSJ6Pcjs.createPayment.call(void 0, 
        this.#seed,
        offer.req,
        {
          maxAmount: offer.limit,
          allowedSplitRecipients: offer.feeWallet ? [offer.feeWallet] : [],
          ...offer.safe ? { guarded: { safe: offer.safe } } : {},
          ...options.permitNonce !== void 0 && !offer.safe ? { permit: { nonce: options.permitNonce } } : {}
        },
        offer.required.resource
      );
    } catch (e) {
      throw new OmniaError(402, "payment_not_built", `The payment could not be built: ${e.message}`, offer.required);
    }
    if (!options.selfPaid) return payload;
    const terms = await this.gas();
    const gas = BigInt(terms.gas);
    const maxFeePerGas = BigInt(terms.maxFeePerGas);
    const maxPriorityFeePerGas = BigInt(terms.maxPriorityFeePerGas);
    if (terms.chainId !== _chunkMZORSJ6Pcjs.ELYSIUM_CHAIN_ID || gas <= 0n || gas > _chunkFFVSGRBMcjs.SELF_PAID_GAS_LIMIT || maxPriorityFeePerGas > maxFeePerGas) {
      throw new OmniaError(0, "network_info_invalid", "The API's gas terms are not ones this client signs: the chain, the gas limit or the fee is out of range.", terms);
    }
    if (BigInt(terms.balanceWei) < gas * maxFeePerGas) {
      throw new OmniaError(
        402,
        "network_fee_unfunded",
        `The relayer is not sponsoring this payment, so the agent submits it and pays its own gas. That can cost up to ${terms.maxCost} HYPE, and ${this.address} holds ${formatHype(terms.balanceWei)} HYPE. Send a little HYPE on Elysium to that address. Nothing was sent.`,
        terms
      );
    }
    const call = _chunkMZORSJ6Pcjs.settleCall.call(void 0, offer.req, payload.payload, offer.safe !== null);
    payload.payload.transaction = await _accounts.privateKeyToAccount.call(void 0, _chunkUTTT7ULNcjs.secretToHex.call(void 0, this.#seed)).signTransaction({
      type: "eip1559",
      chainId: _chunkMZORSJ6Pcjs.ELYSIUM_CHAIN_ID,
      to: call.to,
      data: call.data,
      value: 0n,
      nonce: terms.nonce,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas
    });
    return payload;
  }
  /**
   * Pay a checked offer: sign, send, and answer the three refusals that have a remedy, each at most once, with a
   * new signature for the same offer.
   *   approval_required:        the wallet's first payment. Sign the USDC permit the answer asks for.
   *   sponsorship_unavailable:  the relayer will not pay the gas. Submit the payment as this agent ("auto" only).
   *   stale_transaction:        the agent's transaction number moved on. Read the gas terms again.
   * Any other answer is returned as it is.
   */
  async #pay(offer, send) {
    const refusedByOffer = offer.req.extra.sponsored === false;
    let selfPaid = this.#networkFee === "self" || this.#networkFee === "auto" && (refusedByOffer || Date.now() < this.#selfPayUntil);
    let permitNonce;
    const answered = { approval: false, sponsorship: false, stale: false };
    for (; ; ) {
      const res = await send(_chunkMZORSJ6Pcjs.encodeHeader.call(void 0, await this.#sign(offer, { permitNonce, selfPaid })));
      if (res.status !== 402) return res;
      const refusal = await readRefusal(res.clone());
      if (_optionalChain([refusal, 'optionalAccess', _7 => _7.code]) === "approval_required" && !answered.approval && !offer.safe && refusal.approval && (refusal.approval.spender === null || _chunkUTTT7ULNcjs.sameAddress.call(void 0, refusal.approval.spender, this.#contracts.splitter))) {
        answered.approval = true;
        permitNonce = refusal.approval.nonce;
      } else if (_optionalChain([refusal, 'optionalAccess', _8 => _8.code]) === "sponsorship_unavailable" && !answered.sponsorship && !selfPaid && this.#networkFee === "auto") {
        answered.sponsorship = true;
        this.#selfPayUntil = refusal.sponsorUntil;
        selfPaid = true;
      } else if (_optionalChain([refusal, 'optionalAccess', _9 => _9.code]) === "stale_transaction" && !answered.stale && selfPaid) {
        answered.stale = true;
      } else {
        return res;
      }
    }
  }
  async #paid(method, path, body, options) {
    const first = await this.#send(method, path, { body, sign: options.sign });
    if (first.status !== 402) return this.#json(first);
    const required = await readOffer(first.clone());
    if (!required) return this.#json(first);
    const offer = await this.#checkOffer(required, options.limit, { payTo: options.payTo });
    const second = await this.#pay(offer, (payment) => this.#send(method, path, { body, sign: options.sign, payment }));
    const out = await this.#json(second);
    const header = second.headers.get(_chunkMZORSJ6Pcjs.X402_HEADER.response);
    if (header && out && typeof out === "object") {
      try {
        Object.defineProperty(out, "settlement", { value: _chunkMZORSJ6Pcjs.decodeHeader.call(void 0, header), enumerable: false });
      } catch (e5) {
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
    for (const [k, v] of Object.entries(_nullishCoalesce(options.query, () => ( {})))) {
      if (v !== void 0) url.searchParams.set(k, String(v));
    }
    const text = options.body === void 0 ? void 0 : JSON.stringify(options.body);
    const headers = { accept: "application/json" };
    if (text !== void 0) headers["content-type"] = "application/json";
    if (options.sign) Object.assign(headers, await _chunkUTTT7ULNcjs.signRequest.call(void 0, this.#seed, this.handle, method, url.pathname + url.search, text));
    if (options.payment) headers[_chunkMZORSJ6Pcjs.X402_HEADER.signature] = options.payment;
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
    } catch (e6) {
      body = text;
    }
    if (!res.ok) {
      const raw = body && typeof body === "object" ? body : void 0;
      const err = _optionalChain([raw, 'optionalAccess', _10 => _10.error]);
      let code = res.status === 402 ? "payment_required" : `http_${res.status}`;
      let message = `The request failed with status ${res.status}.`;
      if (err && typeof err === "object") {
        const e = err;
        if (typeof e.code === "string") code = e.code;
        if (typeof e.message === "string") message = e.message;
      } else if (typeof err === "string") {
        message = typeof _optionalChain([raw, 'optionalAccess', _11 => _11.message]) === "string" ? raw.message : err;
        if (typeof _optionalChain([raw, 'optionalAccess', _12 => _12.code]) === "string") code = raw.code;
      }
      throw new OmniaError(res.status, code, message, body);
    }
    return body;
  }
}, _class.__initStatic(), _class);
async function readRefusal(res) {
  try {
    const body = await res.json();
    const err = _optionalChain([body, 'optionalAccess', _13 => _13.error]) && typeof body.error === "object" ? body.error : null;
    const code = _nullishCoalesce(_optionalChain([err, 'optionalAccess', _14 => _14.code]), () => ( _optionalChain([body, 'optionalAccess', _15 => _15.code])));
    if (typeof code !== "string") return null;
    const s = _optionalChain([err, 'optionalAccess', _16 => _16.sponsorship]);
    const daily = _optionalChain([s, 'optionalAccess', _17 => _17.reason]) === "daily_limit" && typeof s.resetsAt === "number" && s.resetsAt * 1e3 > Date.now();
    const a = _optionalChain([err, 'optionalAccess', _18 => _18.approval]);
    const nonce = typeof _optionalChain([a, 'optionalAccess', _19 => _19.nonce]) === "string" || typeof _optionalChain([a, 'optionalAccess', _20 => _20.nonce]) === "number" ? String(a.nonce) : "";
    return {
      code,
      sponsorUntil: daily ? Math.min(s.resetsAt * 1e3, Date.now() + 864e5) : Date.now() + 6e5,
      approval: /^\d{1,78}$/.test(nonce) ? { nonce, spender: typeof _optionalChain([a, 'optionalAccess', _21 => _21.spender]) === "string" ? a.spender : null } : null
    };
  } catch (e7) {
    return null;
  }
}
async function readOffer(res) {
  const header = res.headers.get(_chunkMZORSJ6Pcjs.X402_HEADER.required);
  if (header) {
    try {
      const offer = _chunkMZORSJ6Pcjs.decodeHeader.call(void 0, header);
      if (offer && offer.x402Version === 2 && Array.isArray(offer.accepts)) return offer;
    } catch (e8) {
    }
  }
  try {
    const body = await res.json();
    if (body && body.x402Version === 2 && Array.isArray(body.accepts)) return body;
  } catch (e9) {
  }
  return null;
}











exports.DEFAULT_BASE_URL = DEFAULT_BASE_URL; exports.OMNIA_CONTRACTS = OMNIA_CONTRACTS; exports.explorerTx = explorerTx; exports.explorerAddress = explorerAddress; exports.OmniaError = OmniaError; exports.toMicros = toMicros; exports.formatUsdc = formatUsdc; exports.formatHype = formatHype; exports.Omnia = Omnia;
