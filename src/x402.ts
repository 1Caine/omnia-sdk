/**
 * x402 version 2 on Solana, as Omnia speaks it.
 *
 * The wire format is the public x402 standard: a 402 answer carries a
 * PAYMENT-REQUIRED header, the paid retry carries PAYMENT-SIGNATURE, and the
 * answer to that carries PAYMENT-RESPONSE. Omnia uses the `exact` scheme with
 * the standard `extra.splits` field (section 5 of the Solana scheme), so the
 * publisher and the platform fee wallet are paid by one transaction.
 *
 * A payment leg is either a plain SPL `TransferChecked` signed by the payer,
 * or, for a guarded wallet, a Squads v4 `spendingLimitUse` signed by the
 * agent key. In both cases the payer signs and never needs SOL: the fee payer
 * named in the offer adds its signature and pays the network fee.
 */
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const X402_VERSION = 2;
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;
export const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const SQUADS_PROGRAM = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

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
    feePayer: string;
    memo?: string;
    recentBlockhash?: string;
    lastValidBlockHeight?: string;
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

export interface PaymentPayload {
  x402Version: 2;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: { transaction: string };
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
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
export const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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

/**
 * The transfers a set of requirements asks for, in order: the remainder to
 * `payTo` first, then one per split. Throws when the terms do not add up.
 */
export function legsOf(req: PaymentRequirements): Leg[] {
  if (!AMOUNT.test(req.amount)) throw new Error("amount is not a base unit integer");
  const total = BigInt(req.amount);
  const splits = req.extra.splits ?? [];
  if (splits.length > 8) throw new Error("split_count_exceeded");
  let carved = 0n;
  const seen = new Set<string>([req.payTo]);
  const legs: Leg[] = [];
  for (const s of splits) {
    if (!AMOUNT.test(s.amount) || BigInt(s.amount) <= 0n) throw new Error("split amount is not a positive base unit integer");
    if (seen.has(s.payTo)) throw new Error("split recipients must be distinct");
    seen.add(s.payTo);
    carved += BigInt(s.amount);
    legs.push({ payTo: s.payTo, amount: BigInt(s.amount) });
  }
  const primary = total - carved;
  if (primary <= 0n) throw new Error("split_remainder_not_positive");
  return [{ payTo: req.payTo, amount: primary }, ...legs];
}

// ---------------------------------------------------------------------------
// Squads v4 spending limit (guarded wallets)
// ---------------------------------------------------------------------------

/** First 8 bytes of sha256("global:spending_limit_use"). */
export const SPENDING_LIMIT_USE_DISCRIMINATOR = Uint8Array.from([16, 57, 130, 127, 193, 20, 155, 134]);

const utf8 = (s: string) => new TextEncoder().encode(s);

export function multisigVault(multisig: PublicKey, index = 0): PublicKey {
  return PublicKey.findProgramAddressSync([utf8("multisig"), multisig.toBytes(), utf8("vault"), Uint8Array.from([index])], SQUADS_PROGRAM)[0];
}

export function spendingLimitAddress(multisig: PublicKey, createKey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([utf8("multisig"), multisig.toBytes(), utf8("spending_limit"), createKey.toBytes()], SQUADS_PROGRAM)[0];
}

export interface GuardedSource {
  /** The Squads multisig that owns the vault. */
  multisig: string;
  /** The spending limit account. Omnia derives it from the agent key, so it can be left out. */
  spendingLimit?: string;
}

function u64le(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

export function spendingLimitUseInstruction(input: {
  multisig: PublicKey;
  member: PublicKey;
  spendingLimit: PublicKey;
  vaultIndex: number;
  mint: PublicKey;
  destination: PublicKey;
  amount: bigint;
  decimals: number;
}): TransactionInstruction {
  const vault = multisigVault(input.multisig, input.vaultIndex);
  const data = new Uint8Array(8 + 8 + 1 + 1);
  data.set(SPENDING_LIMIT_USE_DISCRIMINATOR, 0);
  data.set(u64le(input.amount), 8);
  data[16] = input.decimals;
  data[17] = 0; // memo: None
  return new TransactionInstruction({
    programId: SQUADS_PROGRAM,
    keys: [
      { pubkey: input.multisig, isSigner: false, isWritable: false },
      { pubkey: input.member, isSigner: true, isWritable: false },
      { pubkey: input.spendingLimit, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(input.mint, vault, true), isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(input.mint, input.destination, true), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

/** Compute units the payment asks for. The network fee does not depend on it, only the priority fee does. */
export const COMPUTE_UNITS = { transfer: 12_000, guardedLeg: 60_000, base: 40_000 } as const;
export const PRIORITY_MICROLAMPORTS = 1;

export interface PayOptions {
  /** Pay from a guarded wallet through its Squads spending limit instead of from the agent's own token account. */
  guarded?: GuardedSource;
  /** Refuse to pay more than this, in base units. A guard against a server that changes its price. */
  maxAmount?: bigint;
  /** Split recipients the payer accepts. When set, any other split recipient is refused. */
  allowedSplitRecipients?: string[];
  /** Needed only when the offer carries no recent blockhash. */
  getRecentBlockhash?: () => Promise<string>;
}

/**
 * Build and sign the payment transaction for one set of requirements.
 * Returns the PaymentPayload to send in the PAYMENT-SIGNATURE header.
 */
export async function createPayment(seed: Uint8Array, req: PaymentRequirements, opts: PayOptions = {}, resource?: ResourceInfo): Promise<PaymentPayload> {
  if (req.scheme !== "exact") throw new Error(`Unsupported scheme ${req.scheme}`);
  if (req.network !== SOLANA_MAINNET) throw new Error(`Unsupported network ${req.network}`);
  const legs = legsOf(req);
  const total = BigInt(req.amount);
  if (opts.maxAmount !== undefined && total > opts.maxAmount) throw new Error(`The price ${total} is above the limit ${opts.maxAmount} set for this call.`);
  if (opts.allowedSplitRecipients) {
    for (const s of req.extra.splits ?? []) {
      if (!opts.allowedSplitRecipients.includes(s.payTo)) throw new Error(`Unexpected split recipient ${s.payTo}`);
    }
  }
  const payer = Keypair.fromSeed(seed);
  const mint = new PublicKey(req.asset);
  const feePayer = new PublicKey(req.extra.feePayer);
  if (feePayer.equals(payer.publicKey)) throw new Error("The fee payer cannot be the payer.");

  const transfers: TransactionInstruction[] = [];
  if (opts.guarded) {
    const multisig = new PublicKey(opts.guarded.multisig);
    const spendingLimit = opts.guarded.spendingLimit ? new PublicKey(opts.guarded.spendingLimit) : spendingLimitAddress(multisig, payer.publicKey);
    for (const leg of legs) {
      transfers.push(
        spendingLimitUseInstruction({
          multisig,
          member: payer.publicKey,
          spendingLimit,
          // A guarded wallet is always vault 0 of its Squads account, which is what the facilitator checks.
          vaultIndex: 0,
          mint,
          destination: new PublicKey(leg.payTo),
          amount: leg.amount,
          decimals: USDC_DECIMALS,
        }),
      );
    }
  } else {
    const source = getAssociatedTokenAddressSync(mint, payer.publicKey, true);
    for (const leg of legs) {
      const destination = getAssociatedTokenAddressSync(mint, new PublicKey(leg.payTo), true);
      transfers.push(createTransferCheckedInstruction(source, mint, destination, payer.publicKey, leg.amount, USDC_DECIMALS));
    }
  }

  const units = COMPUTE_UNITS.base + legs.length * (opts.guarded ? COMPUTE_UNITS.guardedLeg : COMPUTE_UNITS.transfer);
  const memo = req.extra.memo ?? crypto.randomUUID();
  const blockhash = req.extra.recentBlockhash ?? (await opts.getRecentBlockhash?.());
  if (!blockhash) throw new Error("The offer carries no recent blockhash and no way to fetch one was given.");

  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
      ...transfers,
      new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo, "utf8") }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  return {
    x402Version: 2,
    ...(resource ? { resource } : {}),
    accepted: req,
    payload: { transaction: bytesToBase64(tx.serialize()) },
  };
}

/** Pick the first offer this client can pay: `exact`, Solana mainnet, USDC. */
export function selectRequirements(required: PaymentRequired): PaymentRequirements | null {
  return required.accepts.find((a) => a.scheme === "exact" && a.network === SOLANA_MAINNET && a.asset === USDC_MINT) ?? null;
}
