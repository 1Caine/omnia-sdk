"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; } function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }







var _chunkIABZQI3Ecjs = require('./chunk-IABZQI3E.cjs');

// src/verify.ts
var _web3js = require('@solana/web3.js');
var _spltoken = require('@solana/spl-token');
var _bs58 = require('bs58'); var _bs582 = _interopRequireDefault(_bs58);
var SPONSOR_LIMITS = {
  maxComputeUnits: 4e5,
  /** The priority fee the fee payer pays is units x price. This cap keeps it under 0.00004 SOL. */
  maxMicroLamportsPerUnit: 100,
  maxSplits: 1,
  maxMemoBytes: 256
};
var fail = (reason, detail) => ({ ok: false, reason, detail });
function readU64(data, offset) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}
function readU32(data, offset) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}
function verifyPayment(transactionBase64, req, expect) {
  if (req.scheme !== "exact") return fail("unsupported_scheme");
  if (req.network !== _chunkIABZQI3Ecjs.SOLANA_MAINNET) return fail("unsupported_network");
  if (_optionalChain([req, 'access', _ => _.extra, 'optionalAccess', _2 => _2.feePayer]) !== expect.feePayer) return fail("fee_payer_mismatch", "requirements name another fee payer");
  if ((_nullishCoalesce(_optionalChain([req, 'access', _3 => _3.extra, 'access', _4 => _4.splits, 'optionalAccess', _5 => _5.length]), () => ( 0))) > (_nullishCoalesce(expect.maxSplits, () => ( SPONSOR_LIMITS.maxSplits)))) return fail("split_count_exceeded");
  let legs;
  let mint;
  try {
    legs = _chunkIABZQI3Ecjs.legsOf.call(void 0, req);
    mint = new (0, _web3js.PublicKey)(req.asset);
    for (const l of legs) new (0, _web3js.PublicKey)(l.payTo);
  } catch (e) {
    return fail("invalid_requirements", e.message);
  }
  let tx;
  try {
    tx = _web3js.VersionedTransaction.deserialize(_chunkIABZQI3Ecjs.base64ToBytes.call(void 0, transactionBase64));
  } catch (e2) {
    return fail("invalid_transaction");
  }
  const msg = tx.message;
  if (msg.version !== 0) return fail("unsupported_transaction_version");
  if (msg.addressTableLookups.length > 0) return fail("address_lookup_tables_not_allowed");
  const keys = msg.staticAccountKeys;
  const feePayer = new (0, _web3js.PublicKey)(expect.feePayer);
  if (!keys[0].equals(feePayer)) return fail("fee_payer_mismatch");
  const required = msg.header.numRequiredSignatures;
  if (required !== 2) return fail("too_many_signers", `the transaction needs ${required} signatures, a payment needs exactly 2`);
  const signer = keys[1];
  const signature = tx.signatures[1];
  if (!signature || signature.every((b) => b === 0)) return fail("payer_signature_missing");
  const ixs = msg.compiledInstructions;
  for (const ix of ixs) {
    if (ix.accountKeyIndexes.includes(0)) return fail("fee_payer_in_instruction");
  }
  const expected = 2 + legs.length;
  if (ixs.length !== expected && ixs.length !== expected + 1) return fail("instruction_order", `expected ${expected} or ${expected + 1} instructions, found ${ixs.length}`);
  const limitIx = ixs[0];
  if (!keys[limitIx.programIdIndex].equals(_web3js.ComputeBudgetProgram.programId) || limitIx.data[0] !== 2 || limitIx.data.length !== 5) return fail("instruction_order", "the first instruction must set the compute unit limit");
  if (readU32(limitIx.data, 1) > SPONSOR_LIMITS.maxComputeUnits) return fail("compute_limit_too_high");
  const priceIx = ixs[1];
  if (!keys[priceIx.programIdIndex].equals(_web3js.ComputeBudgetProgram.programId) || priceIx.data[0] !== 3 || priceIx.data.length !== 9) return fail("instruction_order", "the second instruction must set the compute unit price");
  if (readU64(priceIx.data, 1) > BigInt(SPONSOR_LIMITS.maxMicroLamportsPerUnit)) return fail("compute_price_too_high");
  let source = null;
  let multisig = null;
  let spendingLimit = null;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const ix = ixs[2 + i];
    const program = keys[ix.programIdIndex];
    const acct = (n) => keys[ix.accountKeyIndexes[n]];
    const to = new (0, _web3js.PublicKey)(leg.payTo);
    const toAta = _spltoken.getAssociatedTokenAddressSync.call(void 0, mint, to, true);
    if (program.equals(_spltoken.TOKEN_PROGRAM_ID)) {
      if (ix.data[0] !== 12 || ix.data.length !== 10 || ix.accountKeyIndexes.length !== 4) return fail("unknown_instruction", "only TransferChecked is accepted from the token program");
      if (source === "guarded") return fail("mixed_sources");
      source = "wallet";
      if (!acct(1).equals(mint)) return fail("leg_asset_mismatch");
      if (!acct(3).equals(signer)) return fail("leg_unmatched", "the transfer authority must be the payer that signed");
      if (!acct(0).equals(_spltoken.getAssociatedTokenAddressSync.call(void 0, mint, signer, true))) return fail("leg_unmatched", "the transfer must come from the payer's own token account");
      if (!acct(2).equals(toAta)) return fail("leg_recipient_mismatch");
      if (readU64(ix.data, 1) !== leg.amount) return fail("leg_amount_mismatch");
    } else if (program.equals(_chunkIABZQI3Ecjs.SQUADS_PROGRAM)) {
      const d = ix.data;
      if (d.length !== 18 || !_chunkIABZQI3Ecjs.SPENDING_LIMIT_USE_DISCRIMINATOR.every((b, n) => d[n] === b) || ix.accountKeyIndexes.length !== 10) return fail("unknown_instruction", "only spendingLimitUse without a memo is accepted from the Squads program");
      if (source === "wallet") return fail("mixed_sources");
      source = "guarded";
      if (d[17] !== 0) return fail("unknown_instruction");
      if (multisig && !acct(0).equals(multisig)) return fail("mixed_sources");
      multisig = acct(0);
      spendingLimit = acct(2);
      if (!acct(1).equals(signer)) return fail("leg_unmatched", "the spending limit member must be the agent that signed");
      const vault2 = _chunkIABZQI3Ecjs.multisigVault.call(void 0, multisig, 0);
      if (!acct(3).equals(vault2)) return fail("leg_unmatched", "the vault does not belong to the multisig");
      if (!acct(4).equals(to)) return fail("leg_recipient_mismatch");
      if (!acct(6).equals(mint)) return fail("leg_asset_mismatch");
      if (!acct(7).equals(_spltoken.getAssociatedTokenAddressSync.call(void 0, mint, vault2, true))) return fail("leg_unmatched");
      if (!acct(8).equals(toAta)) return fail("leg_recipient_mismatch");
      if (!acct(9).equals(_spltoken.TOKEN_PROGRAM_ID)) return fail("leg_asset_mismatch");
      if (readU64(d, 8) !== leg.amount) return fail("leg_amount_mismatch");
      if (d[16] !== 6) return fail("leg_asset_mismatch");
    } else {
      return fail("unknown_instruction", `program ${program.toBase58()} is not part of a payment`);
    }
  }
  let memo = null;
  if (ixs.length === expected + 1) {
    const m = ixs[expected];
    if (!keys[m.programIdIndex].equals(_chunkIABZQI3Ecjs.MEMO_PROGRAM) || m.accountKeyIndexes.length !== 0) return fail("unknown_instruction", "the last instruction must be a memo");
    if (m.data.length > SPONSOR_LIMITS.maxMemoBytes) return fail("memo_too_long");
    memo = new TextDecoder().decode(m.data);
  }
  if (req.extra.memo !== void 0 && memo !== req.extra.memo) return fail("memo_mismatch");
  const vault = multisig ? _chunkIABZQI3Ecjs.multisigVault.call(void 0, multisig, 0) : null;
  return {
    ok: true,
    signer: signer.toBase58(),
    source,
    payer: (_nullishCoalesce(vault, () => ( signer))).toBase58(),
    multisig: _nullishCoalesce(_optionalChain([multisig, 'optionalAccess', _6 => _6.toBase58, 'call', _7 => _7()]), () => ( null)),
    spendingLimit: _nullishCoalesce(_optionalChain([spendingLimit, 'optionalAccess', _8 => _8.toBase58, 'call', _9 => _9()]), () => ( null)),
    legs,
    total: BigInt(req.amount),
    memo,
    paymentId: _bs582.default.encode(signature),
    transaction: tx
  };
}




exports.SPONSOR_LIMITS = SPONSOR_LIMITS; exports.verifyPayment = verifyPayment;
