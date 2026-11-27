/**
 * Static verification of an x402 payment, as the Omnia facilitator runs it
 * before it submits anything.
 *
 * A payment comes in one of two shapes. Sponsored: the payer sends its signed
 * `Payment` message and the relayer submits it and pays the gas. Self-paid:
 * the payer also sends a transaction it has signed itself, which calls the
 * settling contract with that same message, and the relayer signs nothing and
 * spends nothing.
 *
 * Everything here is pure: a payload in, a verdict out. It proves who signed,
 * and that what was signed is exactly the transfers the charge asks for. The
 * facilitator then simulates the call against the chain, which is what proves
 * the money is there and, for a guarded wallet, that its limits allow it.
 */
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from "viem";
import { ELYSIUM, ELYSIUM_CHAIN_ID, USDC_ADDRESS, legsOf, paymentNonce, recoverPaymentSigner, settleCall, type Leg, type PaymentRequirements, type SignedPayment } from "./x402";

/** What the relayer is prepared to submit. */
export const SPONSOR_LIMITS = {
  maxSplits: 1,
  maxMemoBytes: 256,
  /** How far past the offer's window a deadline may be, to allow for clocks that differ. */
  clockSkewSeconds: 30,
} as const;

/** The most gas a self-paid transaction may ask for. A payment uses well under half of this. */
export const SELF_PAID_GAS_LIMIT = 1_500_000n;

export type VerifyReason =
  | "unsupported_scheme"
  | "unsupported_network"
  | "unsupported_asset"
  | "invalid_requirements"
  | "split_count_exceeded"
  | "invalid_payload"
  | "expired"
  | "deadline_too_far"
  | "signature_mismatch"
  | "invalid_permit"
  | "invalid_transaction"
  | "transaction_mismatch";

export interface VerifiedPayment {
  ok: true;
  /** The payment's number: the hash of the offer's memo. It can settle once. */
  paymentId: Hex;
  /** The agent key that signed. */
  signer: string;
  /** Whose USDC moves: the signer itself, or its guarded wallet. */
  payer: string;
  source: "wallet" | "guarded";
  /** The Safe, for a guarded payment. */
  safe: string | null;
  legs: Leg[];
  total: bigint;
  /** The call that settles the payment. */
  call: { to: `0x${string}`; data: Hex };
  /** True when the payload carries the one-time approval of the splitter. */
  withPermit: boolean;
  /** The payer's own signed transaction, when the payer pays its own gas. Null for a sponsored payment. */
  selfPaid: { raw: Hex; hash: Hex; gas: bigint; maxFeePerGas: bigint; nonce: number } | null;
}

export type VerifyResult = VerifiedPayment | { ok: false; reason: VerifyReason; detail?: string };

const fail = (reason: VerifyReason, detail?: string): VerifyResult => ({ ok: false, reason, detail });
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Check a signed payment against the requirements the facilitator rebuilt from its own charge.
 * `req.extra.validBefore` is the deadline the payer signed, taken from the payload: it is checked here.
 */
export async function verifyPayment(signed: SignedPayment, req: PaymentRequirements, opts: { maxSplits?: number; now?: number } = {}): Promise<VerifyResult> {
  if (req.scheme !== "exact") return fail("unsupported_scheme");
  if (req.network !== ELYSIUM) return fail("unsupported_network");
  if (!same(req.asset, USDC_ADDRESS)) return fail("unsupported_asset");
  if ((req.extra.splits?.length ?? 0) > (opts.maxSplits ?? SPONSOR_LIMITS.maxSplits)) return fail("split_count_exceeded");
  if (typeof req.extra.memo !== "string" || req.extra.memo.length === 0 || new TextEncoder().encode(req.extra.memo).length > SPONSOR_LIMITS.maxMemoBytes) return fail("invalid_requirements", "memo");
  let legs: Leg[];
  try {
    legs = legsOf(req);
  } catch (e) {
    return fail("invalid_requirements", (e as Error).message);
  }

  if (!signed || typeof signed !== "object") return fail("invalid_payload");
  if (!ADDRESS.test(String(signed.payer)) || !ADDRESS.test(String(signed.signer)) || !SIGNATURE.test(String(signed.signature))) return fail("invalid_payload", "payer, signer and signature are required");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!/^\d{1,12}$/.test(String(req.extra.validBefore))) return fail("invalid_requirements", "validBefore");
  const validBefore = Number(req.extra.validBefore);
  if (validBefore <= now) return fail("expired");
  if (validBefore > now + req.maxTimeoutSeconds + SPONSOR_LIMITS.clockSkewSeconds) return fail("deadline_too_far");

  const guarded = !same(signed.payer, signed.signer);
  let recovered: string;
  try {
    recovered = await recoverPaymentSigner(req, signed.payer, guarded, signed.signature);
  } catch {
    return fail("signature_mismatch");
  }
  // A payment that names other recipients, another amount, another deadline or another offer recovers to another address.
  if (!same(recovered, signed.signer)) return fail("signature_mismatch", "the signature is not this signer's signature over these terms");

  if (signed.permit !== undefined) {
    if (guarded) return fail("invalid_permit", "a guarded wallet needs no permit");
    const p = signed.permit;
    if (!p || !/^\d{1,78}$/.test(String(p.value)) || !/^\d{1,12}$/.test(String(p.deadline)) || !SIGNATURE.test(String(p.signature))) return fail("invalid_permit");
    if (Number(p.deadline) <= now) return fail("invalid_permit", "the approval has expired");
  }

  let call: { to: `0x${string}`; data: Hex };
  try {
    call = settleCall(req, signed, guarded);
  } catch (e) {
    return fail("invalid_payload", (e as Error).message);
  }

  let selfPaid: VerifiedPayment["selfPaid"] = null;
  if (signed.transaction !== undefined) {
    if (typeof signed.transaction !== "string" || !/^0x02[0-9a-fA-F]+$/.test(signed.transaction)) return fail("invalid_transaction", "an EIP-1559 transaction is required");
    try {
      const tx = parseTransaction(signed.transaction as TransactionSerialized<"eip1559">);
      const from = await recoverTransactionAddress({ serializedTransaction: signed.transaction as TransactionSerialized<"eip1559"> });
      if (tx.chainId !== ELYSIUM_CHAIN_ID) return fail("transaction_mismatch", "wrong chain");
      if (!same(from, signed.signer)) return fail("transaction_mismatch", "the transaction is not signed by the payment's signer");
      if (!tx.to || !same(tx.to, call.to)) return fail("transaction_mismatch", "the transaction does not call the settling contract");
      if ((tx.data ?? "0x").toLowerCase() !== call.data.toLowerCase()) return fail("transaction_mismatch", "the transaction does not carry this payment");
      if ((tx.value ?? 0n) !== 0n) return fail("transaction_mismatch", "the transaction must carry no HYPE");
      if ((tx.accessList?.length ?? 0) > 0) return fail("transaction_mismatch", "an access list is not allowed");
      const gas = tx.gas ?? 0n;
      if (gas <= 0n || gas > SELF_PAID_GAS_LIMIT) return fail("transaction_mismatch", "the gas limit is out of range");
      selfPaid = { raw: signed.transaction, hash: keccak256(signed.transaction), gas, maxFeePerGas: tx.maxFeePerGas ?? 0n, nonce: tx.nonce ?? 0 };
    } catch {
      return fail("invalid_transaction");
    }
  }

  return {
    ok: true,
    paymentId: paymentNonce(req.extra.memo),
    signer: getAddress(signed.signer),
    payer: getAddress(signed.payer),
    source: guarded ? "guarded" : "wallet",
    safe: guarded ? getAddress(signed.payer) : null,
    legs,
    total: BigInt(req.amount),
    call,
    withPermit: signed.permit !== undefined,
    selfPaid,
  };
}
