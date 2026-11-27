"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }







var _chunkMZORSJ6Pcjs = require('./chunk-MZORSJ6P.cjs');

// src/verify.ts
var _viem = require('viem');
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
  if (req.network !== _chunkMZORSJ6Pcjs.ELYSIUM) return fail("unsupported_network");
  if (!same(req.asset, _chunkMZORSJ6Pcjs.USDC_ADDRESS)) return fail("unsupported_asset");
  if ((_nullishCoalesce(_optionalChain([req, 'access', _ => _.extra, 'access', _2 => _2.splits, 'optionalAccess', _3 => _3.length]), () => ( 0))) > (_nullishCoalesce(opts.maxSplits, () => ( SPONSOR_LIMITS.maxSplits)))) return fail("split_count_exceeded");
  if (typeof req.extra.memo !== "string" || req.extra.memo.length === 0 || new TextEncoder().encode(req.extra.memo).length > SPONSOR_LIMITS.maxMemoBytes) return fail("invalid_requirements", "memo");
  let legs;
  try {
    legs = _chunkMZORSJ6Pcjs.legsOf.call(void 0, req);
  } catch (e) {
    return fail("invalid_requirements", e.message);
  }
  if (!signed || typeof signed !== "object") return fail("invalid_payload");
  if (!ADDRESS.test(String(signed.payer)) || !ADDRESS.test(String(signed.signer)) || !SIGNATURE.test(String(signed.signature))) return fail("invalid_payload", "payer, signer and signature are required");
  const now = _nullishCoalesce(opts.now, () => ( Math.floor(Date.now() / 1e3)));
  if (!/^\d{1,12}$/.test(String(req.extra.validBefore))) return fail("invalid_requirements", "validBefore");
  const validBefore = Number(req.extra.validBefore);
  if (validBefore <= now) return fail("expired");
  if (validBefore > now + req.maxTimeoutSeconds + SPONSOR_LIMITS.clockSkewSeconds) return fail("deadline_too_far");
  const guarded = !same(signed.payer, signed.signer);
  let recovered;
  try {
    recovered = await _chunkMZORSJ6Pcjs.recoverPaymentSigner.call(void 0, req, signed.payer, guarded, signed.signature);
  } catch (e2) {
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
    call = _chunkMZORSJ6Pcjs.settleCall.call(void 0, req, signed, guarded);
  } catch (e) {
    return fail("invalid_payload", e.message);
  }
  let selfPaid = null;
  if (signed.transaction !== void 0) {
    if (typeof signed.transaction !== "string" || !/^0x02[0-9a-fA-F]+$/.test(signed.transaction)) return fail("invalid_transaction", "an EIP-1559 transaction is required");
    try {
      const tx = _viem.parseTransaction.call(void 0, signed.transaction);
      const from = await _viem.recoverTransactionAddress.call(void 0, { serializedTransaction: signed.transaction });
      if (tx.chainId !== _chunkMZORSJ6Pcjs.ELYSIUM_CHAIN_ID) return fail("transaction_mismatch", "wrong chain");
      if (!same(from, signed.signer)) return fail("transaction_mismatch", "the transaction is not signed by the payment's signer");
      if (!tx.to || !same(tx.to, call.to)) return fail("transaction_mismatch", "the transaction does not call the settling contract");
      if ((_nullishCoalesce(tx.data, () => ( "0x"))).toLowerCase() !== call.data.toLowerCase()) return fail("transaction_mismatch", "the transaction does not carry this payment");
      if ((_nullishCoalesce(tx.value, () => ( 0n))) !== 0n) return fail("transaction_mismatch", "the transaction must carry no HYPE");
      if ((_nullishCoalesce(_optionalChain([tx, 'access', _4 => _4.accessList, 'optionalAccess', _5 => _5.length]), () => ( 0))) > 0) return fail("transaction_mismatch", "an access list is not allowed");
      const gas = _nullishCoalesce(tx.gas, () => ( 0n));
      if (gas <= 0n || gas > SELF_PAID_GAS_LIMIT) return fail("transaction_mismatch", "the gas limit is out of range");
      selfPaid = { raw: signed.transaction, hash: _viem.keccak256.call(void 0, signed.transaction), gas, maxFeePerGas: _nullishCoalesce(tx.maxFeePerGas, () => ( 0n)), nonce: _nullishCoalesce(tx.nonce, () => ( 0)) };
    } catch (e3) {
      return fail("invalid_transaction");
    }
  }
  return {
    ok: true,
    paymentId: _chunkMZORSJ6Pcjs.paymentNonce.call(void 0, req.extra.memo),
    signer: _viem.getAddress.call(void 0, signed.signer),
    payer: _viem.getAddress.call(void 0, signed.payer),
    source: guarded ? "guarded" : "wallet",
    safe: guarded ? _viem.getAddress.call(void 0, signed.payer) : null,
    legs,
    total: BigInt(req.amount),
    call,
    withPermit: signed.permit !== void 0,
    selfPaid
  };
}





exports.SPONSOR_LIMITS = SPONSOR_LIMITS; exports.SELF_PAID_GAS_LIMIT = SELF_PAID_GAS_LIMIT; exports.verifyPayment = verifyPayment;
