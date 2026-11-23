/**
 * Static verification of an x402 payment transaction, as the Omnia
 * facilitator runs it before it adds the fee payer's signature.
 *
 * Everything here is pure: bytes in, verdict out. It follows the static
 * layout of the `exact` Solana scheme with splits (section 5.7): compute
 * budget, compute price, one transfer per leg in order, then a memo. A leg
 * is an SPL `TransferChecked` or a Squads v4 `spendingLimitUse`.
 *
 * The facilitator then simulates the transaction against the chain, which is
 * what proves the money is really there and the spending limit allows it.
 */
import { ComputeBudgetProgram, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import {
  MEMO_PROGRAM,
  SPENDING_LIMIT_USE_DISCRIMINATOR,
  SQUADS_PROGRAM,
  SOLANA_MAINNET,
  base64ToBytes,
  legsOf,
  multisigVault,
  type Leg,
  type PaymentRequirements,
} from "./x402";

/** What the fee payer is prepared to sponsor. */
export const SPONSOR_LIMITS = {
  maxComputeUnits: 400_000,
  /** The priority fee the fee payer pays is units x price. This cap keeps it under 0.00004 SOL. */
  maxMicroLamportsPerUnit: 100,
  maxSplits: 1,
  maxMemoBytes: 256,
} as const;

export type VerifyReason =
  | "unsupported_scheme"
  | "unsupported_network"
  | "invalid_requirements"
  | "split_count_exceeded"
  | "invalid_transaction"
  | "unsupported_transaction_version"
  | "address_lookup_tables_not_allowed"
  | "fee_payer_mismatch"
  | "fee_payer_in_instruction"
  | "too_many_signers"
  | "payer_signature_missing"
  | "instruction_order"
  | "compute_limit_too_high"
  | "compute_price_too_high"
  | "unknown_instruction"
  | "leg_unmatched"
  | "leg_amount_mismatch"
  | "leg_recipient_mismatch"
  | "leg_asset_mismatch"
  | "mixed_sources"
  | "memo_mismatch"
  | "memo_too_long";

export interface VerifiedPayment {
  ok: true;
  /** The key that signed the payment: the agent. */
  signer: string;
  /** Where the money comes from: the agent's own wallet, or a guarded wallet's vault. */
  source: "wallet" | "guarded";
  /** The account the USDC leaves: the signer, or the Squads vault. */
  payer: string;
  /** Set for guarded payments. */
  multisig: string | null;
  spendingLimit: string | null;
  legs: Leg[];
  total: bigint;
  memo: string | null;
  /** The signer's signature over the message. Unique per payment, used to refuse a replay. */
  paymentId: string;
  transaction: VersionedTransaction;
}

export type VerifyResult = VerifiedPayment | { ok: false; reason: VerifyReason; detail?: string };

const fail = (reason: VerifyReason, detail?: string): VerifyResult => ({ ok: false, reason, detail });

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}
function readU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

export function verifyPayment(transactionBase64: string, req: PaymentRequirements, expect: { feePayer: string; maxSplits?: number }): VerifyResult {
  if (req.scheme !== "exact") return fail("unsupported_scheme");
  if (req.network !== SOLANA_MAINNET) return fail("unsupported_network");
  if (req.extra?.feePayer !== expect.feePayer) return fail("fee_payer_mismatch", "requirements name another fee payer");
  if ((req.extra.splits?.length ?? 0) > (expect.maxSplits ?? SPONSOR_LIMITS.maxSplits)) return fail("split_count_exceeded");

  let legs: Leg[];
  let mint: PublicKey;
  try {
    legs = legsOf(req);
    mint = new PublicKey(req.asset);
    for (const l of legs) new PublicKey(l.payTo);
  } catch (e) {
    return fail("invalid_requirements", (e as Error).message);
  }

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(base64ToBytes(transactionBase64));
  } catch {
    return fail("invalid_transaction");
  }
  const msg = tx.message;
  if (msg.version !== 0) return fail("unsupported_transaction_version");
  if (msg.addressTableLookups.length > 0) return fail("address_lookup_tables_not_allowed");

  const keys = msg.staticAccountKeys;
  const feePayer = new PublicKey(expect.feePayer);
  if (!keys[0].equals(feePayer)) return fail("fee_payer_mismatch");
  const required = msg.header.numRequiredSignatures;
  if (required !== 2) return fail("too_many_signers", `the transaction needs ${required} signatures, a payment needs exactly 2`);
  const signer = keys[1];
  const signature = tx.signatures[1];
  if (!signature || signature.every((b) => b === 0)) return fail("payer_signature_missing");

  const ixs = msg.compiledInstructions;
  // The fee payer pays the network fee and nothing else: it may not be an account of any instruction.
  for (const ix of ixs) {
    if (ix.accountKeyIndexes.includes(0)) return fail("fee_payer_in_instruction");
  }

  const expected = 2 + legs.length;
  if (ixs.length !== expected && ixs.length !== expected + 1) return fail("instruction_order", `expected ${expected} or ${expected + 1} instructions, found ${ixs.length}`);

  // 1. compute unit limit
  const limitIx = ixs[0];
  if (!keys[limitIx.programIdIndex].equals(ComputeBudgetProgram.programId) || limitIx.data[0] !== 2 || limitIx.data.length !== 5) return fail("instruction_order", "the first instruction must set the compute unit limit");
  if (readU32(limitIx.data, 1) > SPONSOR_LIMITS.maxComputeUnits) return fail("compute_limit_too_high");
  // 2. compute unit price
  const priceIx = ixs[1];
  if (!keys[priceIx.programIdIndex].equals(ComputeBudgetProgram.programId) || priceIx.data[0] !== 3 || priceIx.data.length !== 9) return fail("instruction_order", "the second instruction must set the compute unit price");
  if (readU64(priceIx.data, 1) > BigInt(SPONSOR_LIMITS.maxMicroLamportsPerUnit)) return fail("compute_price_too_high");

  // 3. one transfer per leg, in order
  let source: "wallet" | "guarded" | null = null;
  let multisig: PublicKey | null = null;
  let spendingLimit: PublicKey | null = null;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const ix = ixs[2 + i];
    const program = keys[ix.programIdIndex];
    const acct = (n: number) => keys[ix.accountKeyIndexes[n]];
    const to = new PublicKey(leg.payTo);
    const toAta = getAssociatedTokenAddressSync(mint, to, true);

    if (program.equals(TOKEN_PROGRAM_ID)) {
      // TransferChecked: [source, mint, destination, authority], data = 12, amount u64, decimals u8
      if (ix.data[0] !== 12 || ix.data.length !== 10 || ix.accountKeyIndexes.length !== 4) return fail("unknown_instruction", "only TransferChecked is accepted from the token program");
      if (source === "guarded") return fail("mixed_sources");
      source = "wallet";
      if (!acct(1).equals(mint)) return fail("leg_asset_mismatch");
      if (!acct(3).equals(signer)) return fail("leg_unmatched", "the transfer authority must be the payer that signed");
      if (!acct(0).equals(getAssociatedTokenAddressSync(mint, signer, true))) return fail("leg_unmatched", "the transfer must come from the payer's own token account");
      if (!acct(2).equals(toAta)) return fail("leg_recipient_mismatch");
      if (readU64(ix.data, 1) !== leg.amount) return fail("leg_amount_mismatch");
    } else if (program.equals(SQUADS_PROGRAM)) {
      // spendingLimitUse: see spendingLimitUseInstruction for the account order
      const d = ix.data;
      if (d.length !== 18 || !SPENDING_LIMIT_USE_DISCRIMINATOR.every((b, n) => d[n] === b) || ix.accountKeyIndexes.length !== 10) return fail("unknown_instruction", "only spendingLimitUse without a memo is accepted from the Squads program");
      if (source === "wallet") return fail("mixed_sources");
      source = "guarded";
      if (d[17] !== 0) return fail("unknown_instruction");
      if (multisig && !acct(0).equals(multisig)) return fail("mixed_sources");
      multisig = acct(0);
      spendingLimit = acct(2);
      if (!acct(1).equals(signer)) return fail("leg_unmatched", "the spending limit member must be the agent that signed");
      const vault = multisigVault(multisig, 0);
      if (!acct(3).equals(vault)) return fail("leg_unmatched", "the vault does not belong to the multisig");
      if (!acct(4).equals(to)) return fail("leg_recipient_mismatch");
      if (!acct(6).equals(mint)) return fail("leg_asset_mismatch");
      if (!acct(7).equals(getAssociatedTokenAddressSync(mint, vault, true))) return fail("leg_unmatched");
      if (!acct(8).equals(toAta)) return fail("leg_recipient_mismatch");
      if (!acct(9).equals(TOKEN_PROGRAM_ID)) return fail("leg_asset_mismatch");
      if (readU64(d, 8) !== leg.amount) return fail("leg_amount_mismatch");
      if (d[16] !== 6) return fail("leg_asset_mismatch");
    } else {
      return fail("unknown_instruction", `program ${program.toBase58()} is not part of a payment`);
    }
  }

  // 4. an optional memo, which must be the one the offer asked for when it asked for one
  let memo: string | null = null;
  if (ixs.length === expected + 1) {
    const m = ixs[expected];
    if (!keys[m.programIdIndex].equals(MEMO_PROGRAM) || m.accountKeyIndexes.length !== 0) return fail("unknown_instruction", "the last instruction must be a memo");
    if (m.data.length > SPONSOR_LIMITS.maxMemoBytes) return fail("memo_too_long");
    memo = new TextDecoder().decode(m.data);
  }
  if (req.extra.memo !== undefined && memo !== req.extra.memo) return fail("memo_mismatch");

  const vault = multisig ? multisigVault(multisig, 0) : null;
  return {
    ok: true,
    signer: signer.toBase58(),
    source: source as "wallet" | "guarded",
    payer: (vault ?? signer).toBase58(),
    multisig: multisig?.toBase58() ?? null,
    spendingLimit: spendingLimit?.toBase58() ?? null,
    legs,
    total: BigInt(req.amount),
    memo,
    paymentId: bs58.encode(signature),
    transaction: tx,
  };
}
