import {
  ELYSIUM,
  ELYSIUM_CHAIN_ID,
  USDC_ADDRESS,
  legsOf,
  paymentNonce,
  recoverPaymentSigner,
  settleCall
} from "./chunk-JDAFQGL2.js";

// src/verify.ts
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress } from "viem";
var SPONSOR_LIMITS = {
  maxSplits: 1,
  maxMemoBytes: 256,
  /** How far past the offer's window a deadline may be, to allow for clocks that differ. */
  clockSkewSeconds: 30
};
var SELF_PAID_GAS_LIMIT = 1500000n;
var fail = (reason, detail) => ({ ok: false, reason, detail });
var ADDRESS = /^0x[0-9a-fA-F]{40}$/;
var SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
var same = (a, b) => a.toLowerCase() === b.toLowerCase();
async function verifyPayment(signed, req, opts = {}) {
  if (req.scheme !== "exact") return fail("unsupported_scheme");
  if (req.network !== ELYSIUM) return fail("unsupported_network");
  if (!same(req.asset, USDC_ADDRESS)) return fail("unsupported_asset");
  if ((req.extra.splits?.length ?? 0) > (opts.maxSplits ?? SPONSOR_LIMITS.maxSplits)) return fail("split_count_exceeded");
  if (typeof req.extra.memo !== "string" || req.extra.memo.length === 0 || new TextEncoder().encode(req.extra.memo).length > SPONSOR_LIMITS.maxMemoBytes) return fail("invalid_requirements", "memo");
  let legs;
  try {
    legs = legsOf(req);
  } catch (e) {
    return fail("invalid_requirements", e.message);
  }
  if (!signed || typeof signed !== "object") return fail("invalid_payload");
  if (!ADDRESS.test(String(signed.payer)) || !ADDRESS.test(String(signed.signer)) || !SIGNATURE.test(String(signed.signature))) return fail("invalid_payload", "payer, signer and signature are required");
  const now = opts.now ?? Math.floor(Date.now() / 1e3);
  if (!/^\d{1,12}$/.test(String(req.extra.validBefore))) return fail("invalid_requirements", "validBefore");
  const validBefore = Number(req.extra.validBefore);
  if (validBefore <= now) return fail("expired");
  if (validBefore > now + req.maxTimeoutSeconds + SPONSOR_LIMITS.clockSkewSeconds) return fail("deadline_too_far");
  const guarded = !same(signed.payer, signed.signer);
  let recovered;
  try {
    recovered = await recoverPaymentSigner(req, signed.payer, guarded, signed.signature);
  } catch {
    return fail("signature_mismatch");
  }
  if (!same(recovered, signed.signer)) return fail("signature_mismatch", "the signature is not this signer's signature over these terms");
  if (signed.permit !== void 0) {
    if (guarded) return fail("invalid_permit", "a guarded wallet needs no permit");
    const p = signed.permit;
    if (!p || !/^\d{1,78}$/.test(String(p.value)) || !/^\d{1,12}$/.test(String(p.deadline)) || !SIGNATURE.test(String(p.signature))) return fail("invalid_permit");
    if (Number(p.deadline) <= now) return fail("invalid_permit", "the approval has expired");
  }
  let call;
  try {
    call = settleCall(req, signed, guarded);
  } catch (e) {
    return fail("invalid_payload", e.message);
  }
  let selfPaid = null;
  if (signed.transaction !== void 0) {
    if (typeof signed.transaction !== "string" || !/^0x02[0-9a-fA-F]+$/.test(signed.transaction)) return fail("invalid_transaction", "an EIP-1559 transaction is required");
    try {
      const tx = parseTransaction(signed.transaction);
      const from = await recoverTransactionAddress({ serializedTransaction: signed.transaction });
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
    withPermit: signed.permit !== void 0,
    selfPaid
  };
}

export {
  SPONSOR_LIMITS,
  SELF_PAID_GAS_LIMIT,
  verifyPayment
};
