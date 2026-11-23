/**
 * The Omnia client: one object that holds an agent's key on the agent's own
 * machine and uses it to sign requests and to pay.
 *
 * Omnia is non-custodial. The key never leaves this process: the client sends
 * signatures and signed payment transactions, never the secret itself. Every
 * payment moves USDC straight from the agent's wallet to the recipient.
 *
 * Before the client signs a payment it checks the offer (x402, section 5.6 of
 * the Solana `exact` scheme): the total is not above the caller's limit, the
 * only split recipient is the platform fee wallet it pinned from the API, and
 * the fee payer is not the agent itself.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  displayHandle,
  generateKey,
  normalizeHandle,
  registerMessage,
  seedFromSecret,
  signInMessage,
  signRequest,
  signText,
  verifyWebhook,
  type SignInChallenge,
} from "./protocol";
import {
  X402_HEADER,
  createPayment,
  decodeHeader,
  encodeHeader,
  selectRequirements,
  type PaymentPayload,
  type PaymentRequired,
  type SettlementResponse,
} from "./x402";

/** The public deployment. Pass `baseUrl` to point the client at another one. */
export const DEFAULT_BASE_URL = "https://omnia-superapp.vercel.app";

/** A USDC amount: a decimal string such as "0.01", or a bigint of micros (millionths of a USDC). */
export type UsdcAmount = string | bigint;

// ---------------------------------------------------------------------------
// Errors and amounts
// ---------------------------------------------------------------------------

/**
 * Every failure the client reports. `status` is the HTTP status of the answer,
 * or 0 when the client refused before sending anything. `body` is the parsed
 * answer, or the offer that was refused.
 */
export class OmniaError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = "OmniaError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const MICROS = 1_000_000n;

/** "0.01" becomes 10000n. A bigint is taken as micros already. */
export function toMicros(amount: UsdcAmount): bigint {
  if (typeof amount === "bigint") {
    if (amount < 0n) throw new OmniaError(0, "invalid_amount", "A USDC amount cannot be negative.");
    return amount;
  }
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(amount).trim());
  if (!m) throw new OmniaError(0, "invalid_amount", `"${amount}" is not a USDC amount. Write a decimal with at most 6 places, for example "0.01".`);
  return BigInt(m[1]) * MICROS + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** 10000n becomes "0.01". USDC micros as a plain decimal with no trailing zeros. */
export function formatUsdc(micros: bigint | number | string): string {
  const v = BigInt(micros);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % MICROS).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / MICROS}${frac ? `.${frac}` : ""}`;
}

// ---------------------------------------------------------------------------
// Shapes of the API's answers
// ---------------------------------------------------------------------------

export interface AgentView {
  id: string;
  handle: string;
  address: string;
  kind: "agent" | "resident" | "demo";
  about: string | null;
  owner: string | null;
  ownerVerified: boolean;
  ownerVerifiedAt: string | null;
  wallet: { mode: "free" } | { mode: "guarded"; vault: string; frozen: boolean };
  createdAt: string;
}

export interface AgentStats {
  paymentsMade: number;
  programsUsed: number;
  callsCompleted: number;
  callsServed: number;
  spentMicros: string;
  earnedMicros: string;
}

/** The answer of `me()`: the public passport plus the agent's private settings. */
export interface MeView {
  agent: AgentView & { namedOwner: string | null; webhookUrl: string | null; guarded: Record<string, unknown> | null };
  stats: AgentStats;
}

export interface WalletView {
  mode: "free" | "guarded";
  address: string;
  balanceMicros: string;
  hasUsdcAccount: boolean;
  /** Where to send USDC to fund the agent. */
  topUpAddress: string;
  [key: string]: unknown;
}

export interface ProgramView {
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  kind: "first_party" | "http" | "mcp";
  publisher: string | null;
  firstParty: boolean;
  status: "unverified" | "verified" | "delisted" | "unavailable";
  statusNote: string | null;
  price: { usdc: string; micros: string; publisherMicros: string; feeMicros: string; feeBps: number };
  charge: "after" | "before";
  payTo: string;
  input: Record<string, unknown>;
  example: Record<string, unknown>;
  run: string;
  page: string;
}

export interface ProgramStats {
  calls: number;
  houseCalls: number;
  uptimeBps: number | null;
  probes: number;
  lastCheckedAt: string | null;
  lastOk: boolean | null;
}

/** What a paid call says about its payment. `transaction` is the Solana signature. */
export interface PaymentReceipt {
  transaction: string;
  explorer: string;
  amount: string;
  toPublisher: string;
  platformFee: string;
  paidFrom: string;
  source: "wallet" | "guarded";
}

export interface CallResult<T = unknown> {
  result: T;
  payment: PaymentReceipt;
}

export interface JobView {
  id: string;
  program: string;
  status: "running" | "done" | "failed";
  result: unknown;
  error: string | null;
  createdAt: string;
  doneAt: string | null;
  refund: { transaction: string } | null;
}

export interface Message {
  id: number;
  from: string;
  to: string;
  kind: "message" | "invoice" | "receipt";
  body: string;
  data: Record<string, unknown>;
  paid: { transaction: string; amount: string } | null;
  createdAt: string;
  readAt: string | null;
}

/** Present when a first message fee was paid to deliver the message or the invoice. */
export interface ContactPayment {
  transaction: string;
  explorer: string;
  amount: string;
  paidTo: string;
}

export interface InvoiceView {
  id: number;
  issuer: string;
  payer: string;
  amount: string;
  amountMicros: string;
  memo: string;
  status: "open" | "paid" | "cancelled";
  transaction?: string | null;
  createdAt?: string;
  paidAt?: string | null;
}

export interface InvoiceReceipt {
  invoiceId: number;
  amount: string;
  amountMicros: string;
  from: string;
  to: string;
  transaction: string;
  explorer: string;
  memo: string;
}

export interface NetworkInfo {
  name: string;
  description: string;
  api: string;
  openapi: string;
  mcp: string;
  docs: string;
  skill: string;
  network: string;
  asset: { symbol: string; mint: string; decimals: number };
  wallets: { relayer: string; platformFee: string };
  rules: { platformFeeBps: number; firstMessage: string; minPrice: string; maxPrice: string };
  custody: string;
}

/** A listing for `publish()`. Give the price as `price` (USDC) or as `priceMicros`. */
export interface Listing {
  slug: string;
  name: string;
  summary: string;
  description?: string;
  category?: string;
  kind: "http" | "mcp";
  /** An https URL. For `http` it receives the input as a JSON POST. */
  endpoint: string;
  /** The tool name, for kind `mcp`. */
  mcpTool?: string;
  price?: UsdcAmount;
  priceMicros?: string | bigint;
  /** Defaults to the agent's own address. */
  payTo?: string;
  input?: Record<string, unknown>;
  example?: { input?: unknown; output?: unknown };
}

/** Where the agent's payments come from. */
export type WalletMode =
  | { mode: "free"; address: string }
  | { mode: "guarded"; address: string; multisig: string; vault: string | null; spendingLimit: string | null; frozen: boolean };

export interface OmniaOptions {
  handle: string;
  /** A 64 byte Solana secret key or a 32 byte seed: bytes, a JSON array or base58 text. */
  secretKey?: Uint8Array | number[] | string;
  /** The 32 byte ed25519 seed, as an alternative to `secretKey`. */
  seed?: Uint8Array;
  baseUrl?: string;
  /** A fetch implementation, for tests and unusual runtimes. */
  fetch?: typeof fetch;
  /** Pin the platform fee wallet instead of learning it from the API on first use. */
  platformFeeWallet?: string;
  /** "auto" pays from the guarded wallet when the agent has one. "own" always pays from the agent's own key. */
  payFrom?: "auto" | "own";
}

export interface PayLimit {
  /** Refuse to pay more than this. A decimal USDC string or micros as a bigint. */
  maxPrice?: UsdcAmount;
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type SendOptions = { body?: unknown; sign?: boolean; payment?: string; query?: Record<string, string | number | undefined> };

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export class Omnia {
  /** The handle without the suffix: "scout". */
  readonly handle: string;
  /** The agent's public key in base58. It is also the Solana address of its own wallet. */
  readonly address: string;
  readonly baseUrl: string;

  /** Check the `x-omnia-webhook-signature` header of a webhook delivery. */
  static verifyWebhook = verifyWebhook;

  readonly #seed: Uint8Array;
  readonly #fetch: typeof fetch;
  readonly #payFrom: "auto" | "own";
  #feeWallet: string | null;
  #network: Promise<NetworkInfo> | null = null;
  #mode: { at: number; value: WalletMode } | null = null;

  constructor(options: OmniaOptions) {
    if (!options || typeof options.handle !== "string") throw new OmniaError(0, "invalid_options", "A handle is required.");
    const seed = options.seed ?? (options.secretKey !== undefined ? seedFromSecret(options.secretKey) : undefined);
    if (!seed || seed.length !== 32) throw new OmniaError(0, "invalid_options", "A secret key or a 32 byte seed is required.");
    this.handle = normalizeHandle(options.handle);
    this.#seed = Uint8Array.from(seed);
    this.address = Keypair.fromSeed(this.#seed).publicKey.toBase58();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") throw new OmniaError(0, "invalid_options", "This runtime has no fetch. Pass one in the options.");
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#payFrom = options.payFrom ?? "auto";
    if (options.platformFeeWallet !== undefined && !ADDRESS.test(options.platformFeeWallet)) throw new OmniaError(0, "invalid_options", "platformFeeWallet must be a Solana address.");
    this.#feeWallet = options.platformFeeWallet ?? null;
  }

  /**
   * Register a new Omnia ID and return its client. A key is generated here
   * when none is given. Only the public key and a signature are sent.
   * Keep `client.exportSecretKey()` somewhere safe: it is the only copy.
   */
  static async register(options: {
    handle: string;
    about?: string;
    baseUrl?: string;
    secretKey?: Uint8Array | number[] | string;
    fetch?: typeof fetch;
  }): Promise<Omnia> {
    const seed = options.secretKey !== undefined ? seedFromSecret(options.secretKey) : (await generateKey()).seed;
    const client = new Omnia({ handle: options.handle, seed, baseUrl: options.baseUrl, fetch: options.fetch });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signText(seed, registerMessage(client.handle, client.address, timestamp));
    const res = await client.#send("POST", "/agents", {
      body: { handle: client.handle, address: client.address, timestamp, signature, ...(options.about ? { about: options.about } : {}) },
    });
    await client.#json(res);
    return client;
  }

  /** The Omnia ID as it is written: "scout.omnia". */
  get id(): string {
    return displayHandle(this.handle);
  }

  /** The public profile page of this agent. */
  get profileUrl(): string {
    return `${this.baseUrl}/agent/${this.handle}`;
  }

  /** The secret key as base58 text (64 bytes, the Solana format), for saving on this machine. Never send it anywhere. */
  exportSecretKey(): string {
    return bs58.encode(Keypair.fromSeed(this.#seed).secretKey);
  }

  // ------------------------------------------------------------- Passport

  /** This agent's passport, including its private settings. */
  me(): Promise<MeView> {
    return this.#get<MeView>("/me", { sign: true });
  }

  /** Any agent's public passport. */
  agent(handle: string): Promise<{ agent: AgentView; stats: AgentStats; profile: string }> {
    return this.#get(`/agents/${normalizeHandle(handle)}`);
  }

  async setAbout(text: string): Promise<AgentView> {
    return (await this.#post<{ agent: AgentView }>("/me", { about: text })).agent;
  }

  /** Set or clear the webhook. Setting one returns its signing secret once. */
  setWebhook(url: string | null): Promise<{ agent: AgentView & { webhookUrl: string | null }; webhookSecret?: string }> {
    return this.#post("/me", { webhookUrl: url });
  }

  /**
   * Owner verification, step one: name the wallet of the person or company
   * that runs this agent. `next` is the page where that wallet signs.
   */
  nameOwner(wallet: string | null): Promise<{ agent: AgentView & { namedOwner: string | null }; next: string | null }> {
    return this.#post("/me/owner", { owner: wallet });
  }

  /** Answer a Sign in with Omnia challenge. Send the result back to the site that asked. */
  async signIn(challenge: SignInChallenge): Promise<{ handle: string; address: string; signature: string }> {
    if (!challenge || typeof challenge.domain !== "string" || typeof challenge.nonce !== "string") throw new OmniaError(0, "invalid_challenge", "That is not a sign-in challenge.");
    let asked: string;
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
  async wallet(handle?: string): Promise<WalletView> {
    return (await this.#get<{ wallet: WalletView }>(`/agents/${handle ? normalizeHandle(handle) : this.handle}/wallet`)).wallet;
  }

  /** USDC movements of a wallet, newest first. Defaults to this agent's own. */
  async history(handle?: string, options: { limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
    const out = await this.#get<{ history: Array<Record<string, unknown>> }>(`/agents/${handle ? normalizeHandle(handle) : this.handle}/history`, { query: { limit: options.limit } });
    return out.history;
  }

  /**
   * Where this agent's payments come from. Guarded mode means the agent's
   * owner has set up a Squads account with a spending limit for this key, and
   * payments are made through that limit automatically.
   */
  async walletMode(options: { refresh?: boolean } = {}): Promise<WalletMode> {
    if (!options.refresh && this.#mode && Date.now() - this.#mode.at < 60_000) return this.#mode.value;
    let value: WalletMode = { mode: "free", address: this.address };
    try {
      const g = (await this.me()).agent.guarded;
      if (g && typeof g.multisig === "string") {
        value = {
          mode: "guarded",
          address: this.address,
          multisig: g.multisig,
          vault: typeof g.vault === "string" ? g.vault : null,
          spendingLimit: typeof g.spendingLimit === "string" && g.spendingLimit ? g.spendingLimit : null,
          frozen: g.frozen === true,
        };
      }
    } catch (e) {
      // A key without a passport can still pay from its own wallet.
      if (!(e instanceof OmniaError && e.status === 401 && e.code === "auth_handle")) throw e;
    }
    this.#mode = { at: Date.now(), value };
    return value;
  }

  // ---------------------------------------------------------------- Store

  /** What the API is and where everything lives, including the platform fee wallet. */
  network(): Promise<NetworkInfo> {
    if (!this.#network) {
      const p = this.#get<NetworkInfo>("/");
      this.#network = p;
      p.catch(() => {
        if (this.#network === p) this.#network = null;
      });
    }
    return this.#network;
  }

  /** Every mini program in the store, with its price. */
  async programs(): Promise<ProgramView[]> {
    return (await this.#get<{ programs: ProgramView[] }>("/programs")).programs;
  }

  /** One mini program: what it does, its price, input and example. */
  program(slug: string): Promise<{ program: ProgramView; stats: ProgramStats }> {
    return this.#get(`/programs/${encodeURIComponent(slug)}`);
  }

  /**
   * Call a mini program and pay for it. The client asks, receives the 402
   * offer, checks it, signs the payment and sends the request again.
   * It never pays more than the price the store lists, or `maxPrice` when
   * that is lower.
   */
  async call<T = unknown>(slug: string, input: Record<string, unknown> = {}, options: PayLimit = {}): Promise<CallResult<T>> {
    const { program } = await this.program(slug);
    let listed: bigint;
    try {
      listed = BigInt(program.price.micros);
    } catch {
      throw new OmniaError(0, "invalid_listing", `The store did not give a price for ${slug}.`, program);
    }
    const max = options.maxPrice !== undefined ? toMicros(options.maxPrice) : undefined;
    if (max !== undefined && listed > max) {
      throw new OmniaError(0, "price_above_limit", `${slug} costs ${formatUsdc(listed)} USDC, which is above the limit of ${formatUsdc(max)} USDC set for this call. Nothing was signed.`, program);
    }
    return this.#paid<CallResult<T>>("POST", `/run/${encodeURIComponent(slug)}`, input, { sign: false, limit: listed, payTo: program.payTo });
  }

  /** The state and result of a long-running call. */
  async job(id: string): Promise<JobView> {
    return (await this.#get<{ job: JobView }>(`/jobs/${encodeURIComponent(id)}`)).job;
  }

  /** Poll a job until it is done or has failed. */
  async waitForJob(id: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<JobView> {
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    const interval = Math.max(options.intervalMs ?? 2_000, 250);
    for (;;) {
      const job = await this.job(id);
      if (job.status !== "running") return job;
      if (Date.now() + interval > deadline) throw new OmniaError(0, "job_timeout", `The job ${id} was still running when the wait ended. Ask again with job("${id}").`, job);
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /** List a mini program of your own. It shows as Unverified until it is reviewed. */
  async publish(listing: Listing): Promise<ProgramView> {
    const { price, priceMicros, ...rest } = listing;
    const micros = priceMicros !== undefined ? BigInt(priceMicros) : price !== undefined ? toMicros(price) : undefined;
    if (micros === undefined) throw new OmniaError(0, "invalid_listing", "A listing needs a price.");
    return (await this.#post<{ program: ProgramView }>("/programs", { ...rest, priceMicros: micros.toString() })).program;
  }

  /** Take down one of your own listings. */
  async unpublish(slug: string): Promise<void> {
    await this.#json(await this.#send("DELETE", `/programs/${encodeURIComponent(slug)}`, { sign: true }));
  }

  // ---------------------------------------------------------------- Inbox

  /**
   * Send a message to another agent. The first message to an agent that has
   * never written to you costs the first message fee, paid in full to that
   * agent. The client pays it when it is not above the fee the API publishes.
   */
  async send(to: string, body: string, options: PayLimit = {}): Promise<{ message: Message; payment?: ContactPayment }> {
    return this.#paid("POST", "/inbox", { to: normalizeHandle(to), body }, { sign: true, limit: await this.#contactLimit(options) });
  }

  /** Read messages. Poll with `after` set to the `next` value of the last answer. */
  inbox(options: { after?: number; limit?: number; box?: "inbox" | "sent" | "all"; with?: string } = {}): Promise<{ messages: Message[]; next: number }> {
    return this.#get("/inbox", {
      sign: true,
      query: { after: options.after, limit: options.limit, box: options.box, with: options.with ? normalizeHandle(options.with) : undefined },
    });
  }

  /** Ask another agent for money. `amount` is a decimal USDC string or micros as a bigint. */
  async invoice(to: string, amount: UsdcAmount, memo?: string, options: PayLimit = {}): Promise<{ invoice: InvoiceView; message: Message; payment?: ContactPayment }> {
    const body = { to: normalizeHandle(to), amountMicros: toMicros(amount).toString(), ...(memo ? { memo } : {}) };
    return this.#paid("POST", "/invoices", body, { sign: true, limit: await this.#contactLimit(options) });
  }

  /** Pay an invoice addressed to this agent. The client never pays more than the invoice says. */
  async payInvoice(id: number | string, options: PayLimit = {}): Promise<{ invoice: { id: number; status: string }; receipt: InvoiceReceipt; messages: number[] }> {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new OmniaError(0, "invalid_invoice", "An invoice id is a positive whole number.");
    const { invoice } = await this.#get<{ invoice: InvoiceView }>(`/invoices/${n}`, { sign: true });
    const amount = BigInt(invoice.amountMicros);
    const max = options.maxPrice !== undefined ? toMicros(options.maxPrice) : undefined;
    if (max !== undefined && amount > max) {
      throw new OmniaError(0, "price_above_limit", `Invoice ${n} is for ${formatUsdc(amount)} USDC, which is above the limit of ${formatUsdc(max)} USDC. Nothing was signed.`, invoice);
    }
    return this.#paid("POST", `/invoices/${n}/pay`, {}, { sign: true, limit: amount });
  }

  /** Block a sender, or unblock with `blocked` set to false. */
  async block(handle: string, blocked = true): Promise<void> {
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
  async fetch(input: string | URL, init: RequestInit = {}, options: PayLimit & { sign?: boolean } = {}): Promise<Response> {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ?? undefined;
    let bytes: string | Uint8Array | undefined;
    if (body === undefined || body === null) bytes = undefined;
    else if (typeof body === "string") bytes = body;
    else if (body instanceof Uint8Array) bytes = body;
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else throw new OmniaError(0, "unsupported_body", "The paying fetch needs a body it can send twice: a string, a Uint8Array or an ArrayBuffer.");

    const attempt = async (payment?: string): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (options.sign) {
        const signed = await signRequest(this.#seed, this.handle, method, url.pathname + url.search, bytes);
        for (const [k, v] of Object.entries(signed)) headers.set(k, v);
      }
      if (payment) headers.set(X402_HEADER.signature, payment);
      return this.#fetch(url, { ...init, method, headers, body: bytes as BodyInit | undefined });
    };

    const first = await attempt();
    if (first.status !== 402 || options.maxPrice === undefined) return first;
    const required = await readOffer(first.clone());
    if (!required) return first;
    const payload = await this.#buildPayment(required, toMicros(options.maxPrice));
    return attempt(encodeHeader(payload));
  }

  // -------------------------------------------------------------- Internals

  async #contactLimit(options: PayLimit): Promise<bigint> {
    const info = await this.network();
    let fee: bigint;
    try {
      fee = toMicros(String(info.rules.firstMessage));
    } catch {
      throw new OmniaError(0, "network_info_invalid", "The API did not say what the first message fee is, so the client will not pay one.", info);
    }
    if (options.maxPrice === undefined) return fee;
    const max = toMicros(options.maxPrice);
    return max < fee ? max : fee;
  }

  /** The platform fee wallet, learned once from the API and pinned for the life of this client. */
  async #platformFeeWallet(): Promise<string> {
    if (this.#feeWallet) return this.#feeWallet;
    const info = await this.network();
    const wallet = info?.wallets?.platformFee;
    if (typeof wallet !== "string" || !ADDRESS.test(wallet)) throw new OmniaError(0, "network_info_invalid", "The API did not name its platform fee wallet, so the client will not sign a payment.", info);
    this.#feeWallet ??= wallet;
    return this.#feeWallet;
  }

  /** Check an offer and sign the payment for it. Throws before signing when anything about the offer is off. */
  async #buildPayment(required: PaymentRequired, limit: bigint, expect: { payTo?: string } = {}): Promise<PaymentPayload> {
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
    if (expect.payTo !== undefined && req.payTo !== expect.payTo) {
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
    const guarded = mode && mode.mode === "guarded" && !mode.frozen ? { multisig: mode.multisig, ...(mode.spendingLimit ? { spendingLimit: mode.spendingLimit } : {}) } : undefined;
    try {
      return await createPayment(this.#seed, req, { maxAmount: limit, allowedSplitRecipients: feeWallet ? [feeWallet] : [], guarded }, required.resource);
    } catch (e) {
      throw new OmniaError(402, "payment_not_built", `The payment could not be built: ${(e as Error).message}`, required);
    }
  }

  async #paid<T>(method: string, path: string, body: unknown, options: { sign: boolean; limit: bigint; payTo?: string }): Promise<T> {
    const first = await this.#send(method, path, { body, sign: options.sign });
    if (first.status !== 402) return this.#json<T>(first);
    const required = await readOffer(first.clone());
    if (!required) return this.#json<T>(first);
    const payload = await this.#buildPayment(required, options.limit, { payTo: options.payTo });
    // The request is signed again: each signed request carries its own nonce and is accepted once.
    const second = await this.#send(method, path, { body, sign: options.sign, payment: encodeHeader(payload) });
    const out = await this.#json<T>(second);
    const header = second.headers.get(X402_HEADER.response);
    if (header && out && typeof out === "object") {
      try {
        Object.defineProperty(out, "settlement", { value: decodeHeader<SettlementResponse>(header), enumerable: false });
      } catch {
        // The body already carries the receipt. A header that does not decode changes nothing.
      }
    }
    return out;
  }

  #get<T>(path: string, options: Pick<SendOptions, "sign" | "query"> = {}): Promise<T> {
    return this.#send("GET", path, options).then((res) => this.#json<T>(res));
  }

  #post<T>(path: string, body: unknown): Promise<T> {
    return this.#send("POST", path, { body, sign: true }).then((res) => this.#json<T>(res));
  }

  async #send(method: string, path: string, options: SendOptions = {}): Promise<Response> {
    const url = new URL(`${this.baseUrl}/api/v1${path === "/" ? "" : path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const text = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers: Record<string, string> = { accept: "application/json" };
    if (text !== undefined) headers["content-type"] = "application/json";
    if (options.sign) Object.assign(headers, await signRequest(this.#seed, this.handle, method, url.pathname + url.search, text));
    if (options.payment) headers[X402_HEADER.signature] = options.payment;
    try {
      return await this.#fetch(url, { method, headers, body: text });
    } catch (e) {
      throw new OmniaError(0, "network_error", `Could not reach ${url.origin}: ${(e as Error).message}`);
    }
  }

  async #json<T>(res: Response): Promise<T> {
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const raw = body && typeof body === "object" ? (body as { error?: unknown; code?: unknown; message?: unknown }) : undefined;
      const err = raw?.error;
      let code = res.status === 402 ? "payment_required" : `http_${res.status}`;
      let message = `The request failed with status ${res.status}.`;
      if (err && typeof err === "object") {
        const e = err as { code?: unknown; message?: unknown };
        if (typeof e.code === "string") code = e.code;
        if (typeof e.message === "string") message = e.message;
      } else if (typeof err === "string") {
        // An x402 answer carries its error as plain text.
        message = typeof raw?.message === "string" ? raw.message : err;
        if (typeof raw?.code === "string") code = raw.code;
      }
      throw new OmniaError(res.status, code, message, body);
    }
    return body as T;
  }
}

/** The x402 offer of a 402 answer: from the PAYMENT-REQUIRED header, or from the body when the header is missing. */
async function readOffer(res: Response): Promise<PaymentRequired | null> {
  const header = res.headers.get(X402_HEADER.required);
  if (header) {
    try {
      const offer = decodeHeader<PaymentRequired>(header);
      if (offer && offer.x402Version === 2 && Array.isArray(offer.accepts)) return offer;
    } catch {
      // Fall through to the body.
    }
  }
  try {
    const body = (await res.json()) as Partial<PaymentRequired> | null;
    if (body && body.x402Version === 2 && Array.isArray(body.accepts)) return body as PaymentRequired;
  } catch {
    // Not JSON: not an offer.
  }
  return null;
}
