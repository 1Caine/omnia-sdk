/**
 * x402 version 2 on Elysium, as Omnia speaks it.
 *
 * The wire format is the public x402 format: a 402 answer carries a
 * PAYMENT-REQUIRED header, the paid retry carries PAYMENT-SIGNATURE, and the
 * answer to that carries PAYMENT-RESPONSE. Omnia uses the `exact` scheme with
 * `extra.splits`, so the publisher and the platform fee wallet are paid by one
 * transaction.
 *
 * What the payer signs is one EIP-712 message, `Payment`: who is paid, how
 * much each, a number that can be used once and a deadline. A contract checks
 * that signature and moves USDC straight from the payer to each recipient:
 * the splitter for an agent's own wallet, the guard for a guarded wallet (a
 * Safe). The payer never needs HYPE: the relayer named in the offer submits
 * the payment and pays its gas. The settling is done by Omnia's own
 * facilitator, which is what the offer's `extra` fields are for.
 */
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, getAddress, hashTypedData, keccak256, parseSignature, recoverTypedDataAddress, toBytes, type Hex } from "viem";

export const X402_VERSION = 2;
export const ELYSIUM_CHAIN_ID = 99901;
/** The network name in offers and receipts, in CAIP-2 form. */
export const ELYSIUM = `eip155:${ELYSIUM_CHAIN_ID}`;
export const USDC_ADDRESS = "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65";
export const USDC_DECIMALS = 6;
/** The EIP-712 domain of USDC on Elysium, which its `permit` checks. Read from the token and tested against it. */
export const USDC_PERMIT_DOMAIN = { name: "USDC", version: "1", chainId: ELYSIUM_CHAIN_ID, verifyingContract: USDC_ADDRESS } as const;
export const MAX_LEGS = 8;
const MAX_UINT256 = (1n << 256n) - 1n;

export const X402_HEADER = {
  required: "payment-required",
  signature: "payment-signature",
  response: "payment-response",
} as const;

export interface Split {
  payTo: string;
  /** Absolute amount in base units, carved out of the total. */
  amount: string;
  memo?: string;
}

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  /** The total the payer pays, in base units of `asset`. */
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    /** The contract that settles a payment from an agent's own wallet. The payer's signature names it. */
    splitter: string;
    /** The contract that settles a payment from a guarded wallet. The agent's signature names it. */
    guard: string;
    /** The wallet that submits the payment and pays its gas when the payment is sponsored. */
    relayer: string;
    /** False when the relayer does not sponsor this payment and the payer submits it and pays its own gas. Absent means sponsored. */
    sponsored?: boolean;
    /** Ties the payment to the request it pays for. The payment's number is its hash. */
    memo: string;
    /** Unix seconds: the payment cannot settle from this moment on. */
    validBefore: string;
    splits?: Split[];
    [key: string]: unknown;
  };
}

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
}

/** The payer's signed approval of the splitter (ERC-2612), sent with the first payment a wallet ever makes. */
export interface SignedPermit {
  value: string;
  deadline: string;
  signature: Hex;
}

export interface SignedPayment {
  /** Whose USDC moves: the signer's own address, or the guarded wallet (the Safe). */
  payer: string;
  /** The agent key that signed. */
  signer: string;
  /** 65 bytes, 0x hex: the EIP-712 signature over the payment. */
  signature: Hex;
  permit?: SignedPermit;
  /**
   * Set when the payer pays its own gas: the EIP-1559 transaction it signed, which calls the settling contract
   * with this same payment. Raw, 0x hex. The facilitator sends it only after the work has succeeded.
   */
  transaction?: Hex;
}

export interface PaymentPayload {
  x402Version: 2;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: SignedPayment;
}

export interface SettlementResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer: string;
  errorReason?: string;
}

// ---------------------------------------------------------------------------
// Header encoding
// ---------------------------------------------------------------------------

const b64encode = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64decode = (b64: string): string => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

export const encodeHeader = (value: unknown): string => b64encode(JSON.stringify(value));
export function decodeHeader<T>(value: string): T {
  return JSON.parse(b64decode(value)) as T;
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

export interface Leg {
  payTo: string;
  amount: bigint;
}

const AMOUNT = /^(0|[1-9]\d{0,19})$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The transfers a set of requirements asks for, in order: the remainder to
 * `payTo` first, then one per split. Throws when the terms do not add up.
 */
export function legsOf(req: PaymentRequirements): Leg[] {
  if (!AMOUNT.test(req.amount)) throw new Error("amount is not a base unit integer");
  if (!ADDRESS.test(req.payTo)) throw new Error("payTo is not an address");
  const total = BigInt(req.amount);
  const splits = req.extra.splits ?? [];
  if (splits.length > MAX_LEGS - 1) throw new Error("split_count_exceeded");
  let carved = 0n;
  const seen = new Set<string>([req.payTo.toLowerCase()]);
  const legs: Leg[] = [];
  for (const s of splits) {
    if (!AMOUNT.test(s.amount) || BigInt(s.amount) <= 0n) throw new Error("split amount is not a positive base unit integer");
    if (!ADDRESS.test(s.payTo)) throw new Error("split recipient is not an address");
    if (seen.has(s.payTo.toLowerCase())) throw new Error("split recipients must be distinct");
    seen.add(s.payTo.toLowerCase());
    carved += BigInt(s.amount);
    legs.push({ payTo: getAddress(s.payTo), amount: BigInt(s.amount) });
  }
  const primary = total - carved;
  if (primary <= 0n) throw new Error("split_remainder_not_positive");
  return [{ payTo: getAddress(req.payTo), amount: primary }, ...legs];
}

// ---------------------------------------------------------------------------
// The signed message and the contract calls that settle it
// ---------------------------------------------------------------------------

/** The EIP-712 type both settling contracts check. */
export const PAYMENT_TYPES = {
  Payment: [
    { name: "payer", type: "address" },
    { name: "token", type: "address" },
    { name: "to", type: "address[]" },
    { name: "amounts", type: "uint256[]" },
    { name: "nonce", type: "bytes32" },
    { name: "validBefore", type: "uint256" },
  ],
} as const;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const PAYMENT_TUPLE = {
  type: "tuple",
  name: "p",
  components: [
    { name: "payer", type: "address" },
    { name: "token", type: "address" },
    { name: "to", type: "address[]" },
    { name: "amounts", type: "uint256[]" },
    { name: "nonce", type: "bytes32" },
    { name: "validBefore", type: "uint256" },
  ],
} as const;

const PAID_EVENT_INPUTS = (second: string) =>
  [
    { name: "nonce", type: "bytes32", indexed: true },
    { name: second, type: "address", indexed: true },
    { name: second === "payer" ? "token" : "agent", type: "address", indexed: true },
    { name: "to", type: "address[]", indexed: false },
    { name: "amounts", type: "uint256[]", indexed: false },
  ] as const;

export const SPLITTER_ABI = [
  { type: "function", name: "pay", stateMutability: "nonpayable", inputs: [PAYMENT_TUPLE, { name: "signature", type: "bytes" }], outputs: [] },
  {
    type: "function",
    name: "payWithPermit",
    stateMutability: "nonpayable",
    inputs: [PAYMENT_TUPLE, { name: "signature", type: "bytes" }, { name: "permitValue", type: "uint256" }, { name: "permitDeadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }],
    outputs: [],
  },
  { type: "function", name: "used", stateMutability: "view", inputs: [{ name: "payer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "event", name: "Paid", inputs: PAID_EVENT_INPUTS("payer") },
  { type: "error", name: "Expired", inputs: [] },
  { type: "error", name: "BadLegs", inputs: [] },
  { type: "error", name: "NonceUsed", inputs: [] },
  { type: "error", name: "BadSignature", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
] as const;

export const GUARD_ABI = [
  { type: "function", name: "pay", stateMutability: "nonpayable", inputs: [PAYMENT_TUPLE, { name: "signature", type: "bytes" }], outputs: [] },
  { type: "function", name: "configure", stateMutability: "nonpayable", inputs: [{ name: "agent", type: "address" }, { name: "perPayment", type: "uint96" }, { name: "destinations", type: "address[]" }], outputs: [] },
  { type: "function", name: "freeze", stateMutability: "nonpayable", inputs: [{ name: "safe", type: "address" }], outputs: [] },
  { type: "function", name: "unfreeze", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "used", stateMutability: "view", inputs: [{ name: "safe", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "policyOf",
    stateMutability: "view",
    inputs: [{ name: "safe", type: "address" }],
    outputs: [{ name: "agent", type: "address" }, { name: "perPayment", type: "uint96" }, { name: "frozen", type: "bool" }, { name: "restricted", type: "bool" }],
  },
  { type: "function", name: "allowed", stateMutability: "view", inputs: [{ name: "safe", type: "address" }, { name: "to", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "event", name: "Paid", inputs: PAID_EVENT_INPUTS("safe") },
  { type: "event", name: "Configured", inputs: [{ name: "safe", type: "address", indexed: true }, { name: "agent", type: "address", indexed: true }, { name: "perPayment", type: "uint96", indexed: false }, { name: "destinations", type: "address[]", indexed: false }] },
  { type: "event", name: "Frozen", inputs: [{ name: "safe", type: "address", indexed: true }, { name: "by", type: "address", indexed: true }] },
  { type: "event", name: "Unfrozen", inputs: [{ name: "safe", type: "address", indexed: true }] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "TooManyDestinations", inputs: [] },
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "NotConfigured", inputs: [] },
  { type: "error", name: "WalletFrozen", inputs: [] },
  { type: "error", name: "Expired", inputs: [] },
  { type: "error", name: "BadLegs", inputs: [] },
  { type: "error", name: "WrongToken", inputs: [] },
  { type: "error", name: "NonceUsed", inputs: [] },
  { type: "error", name: "OverPaymentCap", inputs: [] },
  { type: "error", name: "DestinationNotAllowed", inputs: [{ name: "to", type: "address" }] },
  { type: "error", name: "BadSignature", inputs: [] },
] as const;

/** The payment as the contracts take it. */
export interface PaymentMessage {
  payer: `0x${string}`;
  token: `0x${string}`;
  to: `0x${string}`[];
  amounts: bigint[];
  nonce: Hex;
  validBefore: bigint;
}

/** A payment's number: the hash of the offer's memo. One offer, one payment. */
export const paymentNonce = (memo: string): Hex => keccak256(toBytes(memo));

export function paymentDomain(name: "Omnia Splitter" | "Omnia Guard", verifyingContract: string) {
  return { name, version: "1", chainId: ELYSIUM_CHAIN_ID, verifyingContract: getAddress(verifyingContract) } as const;
}

/** The message a payer signs for these requirements. `payer` is the signer's own address, or its guarded wallet. */
export function paymentMessage(req: PaymentRequirements, payer: string): PaymentMessage {
  const legs = legsOf(req);
  if (!/^\d{1,12}$/.test(String(req.extra.validBefore ?? ""))) throw new Error("The offer carries no deadline.");
  if (typeof req.extra.memo !== "string" || req.extra.memo.length === 0 || req.extra.memo.length > 256) throw new Error("The offer carries no memo.");
  return {
    payer: getAddress(payer),
    token: getAddress(req.asset),
    to: legs.map((l) => getAddress(l.payTo)),
    amounts: legs.map((l) => l.amount),
    nonce: paymentNonce(req.extra.memo),
    validBefore: BigInt(req.extra.validBefore),
  };
}

/** The contract and domain a payment for these requirements is signed for. */
export function settlerOf(req: PaymentRequirements, guarded: boolean) {
  const address = guarded ? req.extra.guard : req.extra.splitter;
  if (typeof address !== "string" || !ADDRESS.test(address)) throw new Error("The offer does not name the contract that settles it.");
  return { address: getAddress(address), domain: paymentDomain(guarded ? "Omnia Guard" : "Omnia Splitter", address) };
}

export function paymentDigest(req: PaymentRequirements, payer: string, guarded: boolean): Hex {
  return hashTypedData({ domain: settlerOf(req, guarded).domain, types: PAYMENT_TYPES, primaryType: "Payment", message: paymentMessage(req, payer) });
}

/** Who signed a payment. */
export async function recoverPaymentSigner(req: PaymentRequirements, payer: string, guarded: boolean, signature: Hex): Promise<string> {
  return recoverTypedDataAddress({ domain: settlerOf(req, guarded).domain, types: PAYMENT_TYPES, primaryType: "Payment", message: paymentMessage(req, payer), signature });
}

/** The call that settles a signed payment: the contract to call and its data. Whoever sends it pays the gas. */
export function settleCall(req: PaymentRequirements, signed: Pick<SignedPayment, "payer" | "signature" | "permit">, guarded: boolean): { to: `0x${string}`; data: Hex } {
  const message = paymentMessage(req, signed.payer);
  const to = settlerOf(req, guarded).address;
  if (guarded) return { to, data: encodeFunctionData({ abi: GUARD_ABI, functionName: "pay", args: [message, signed.signature] }) };
  if (!signed.permit) return { to, data: encodeFunctionData({ abi: SPLITTER_ABI, functionName: "pay", args: [message, signed.signature] }) };
  const sig = parseSignature(signed.permit.signature);
  const v = sig.v !== undefined ? Number(sig.v) : 27 + Number(sig.yParity);
  return {
    to,
    data: encodeFunctionData({ abi: SPLITTER_ABI, functionName: "payWithPermit", args: [message, signed.signature, BigInt(signed.permit.value), BigInt(signed.permit.deadline), v, sig.r, sig.s] }),
  };
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

export interface GuardedSource {
  /** The Safe that is the agent's guarded wallet. */
  safe: string;
}

export interface PermitRequest {
  /** The payer's current permit nonce on the token, as the token reports it. */
  nonce: bigint | string | number;
  /** How long the approval signature stays usable, in seconds. Default one hour. */
  ttlSeconds?: number;
}

export interface PayOptions {
  /** Pay from a guarded wallet (a Safe) through the guard, instead of from the agent's own address. */
  guarded?: GuardedSource;
  /** Refuse to pay more than this, in base units. A guard against a server that changes its price. */
  maxAmount?: bigint;
  /** Split recipients the payer accepts. When set, any other split recipient is refused. */
  allowedSplitRecipients?: string[];
  /** Sign the one-time approval of the splitter too. Needed for the first payment from a wallet. */
  permit?: PermitRequest;
  /** The clock, for tests. */
  now?: number;
}

/** Sign the payer's ERC-2612 approval of the splitter for any amount. It is sent once, with the wallet's first payment. */
export async function signPermit(seed: Uint8Array, spender: string, request: PermitRequest, now = Math.floor(Date.now() / 1000)): Promise<SignedPermit> {
  const account = privateKeyToAccount(`0x${[...seed].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  const deadline = BigInt(now + (request.ttlSeconds ?? 3600));
  const signature = await account.signTypedData({
    domain: USDC_PERMIT_DOMAIN,
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: account.address, spender: getAddress(spender), value: MAX_UINT256, nonce: BigInt(request.nonce), deadline },
  });
  return { value: MAX_UINT256.toString(), deadline: deadline.toString(), signature };
}

/**
 * Sign the payment for one set of requirements.
 * Returns the PaymentPayload to send in the PAYMENT-SIGNATURE header.
 */
export async function createPayment(seed: Uint8Array, req: PaymentRequirements, opts: PayOptions = {}, resource?: ResourceInfo): Promise<PaymentPayload> {
  if (req.scheme !== "exact") throw new Error(`Unsupported scheme ${req.scheme}`);
  if (req.network !== ELYSIUM) throw new Error(`Unsupported network ${req.network}`);
  if (req.asset.toLowerCase() !== USDC_ADDRESS.toLowerCase()) throw new Error(`Unsupported asset ${req.asset}`);
  const total = BigInt(req.amount);
  if (opts.maxAmount !== undefined && total > opts.maxAmount) throw new Error(`The price ${total} is above the limit ${opts.maxAmount} set for this call.`);
  if (opts.allowedSplitRecipients) {
    const allowed = opts.allowedSplitRecipients.map((a) => a.toLowerCase());
    for (const s of req.extra.splits ?? []) {
      if (!allowed.includes(s.payTo.toLowerCase())) throw new Error(`Unexpected split recipient ${s.payTo}`);
    }
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Number(req.extra.validBefore) <= now) throw new Error("The offer has expired. Ask for a new one.");

  const account = privateKeyToAccount(`0x${[...seed].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  const guarded = opts.guarded !== undefined;
  const payer = guarded ? getAddress(opts.guarded!.safe) : account.address;
  const settler = settlerOf(req, guarded);
  const signature = await account.signTypedData({ domain: settler.domain, types: PAYMENT_TYPES, primaryType: "Payment", message: paymentMessage(req, payer) });
  // A guarded wallet is a Safe: its allowance lives in the Safe's own module, so there is nothing to permit.
  const permit = !guarded && opts.permit ? await signPermit(seed, settler.address, opts.permit, now) : undefined;
  return {
    x402Version: 2,
    ...(resource ? { resource } : {}),
    accepted: req,
    payload: { payer, signer: account.address, signature, ...(permit ? { permit } : {}) },
  };
}

/** Pick the first offer this client can pay: `exact`, Elysium, USDC. */
export function selectRequirements(required: PaymentRequired): PaymentRequirements | null {
  return required.accepts.find((a) => a.scheme === "exact" && a.network === ELYSIUM && typeof a.asset === "string" && a.asset.toLowerCase() === USDC_ADDRESS.toLowerCase()) ?? null;
}
