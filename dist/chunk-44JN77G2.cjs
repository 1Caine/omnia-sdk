"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } async function _asyncNullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return await rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }// src/x402.ts








var _web3js = require('@solana/web3.js');
var _spltoken = require('@solana/spl-token');
var X402_VERSION = 2;
var SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
var USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
var USDC_DECIMALS = 6;
var MEMO_PROGRAM = new (0, _web3js.PublicKey)("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
var SQUADS_PROGRAM = new (0, _web3js.PublicKey)("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
var X402_HEADER = {
  required: "payment-required",
  signature: "payment-signature",
  response: "payment-response"
};
var b64encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
var b64decode = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};
var bytesToBase64 = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
var base64ToBytes = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};
var encodeHeader = (value) => b64encode(JSON.stringify(value));
function decodeHeader(value) {
  return JSON.parse(b64decode(value));
}
var AMOUNT = /^(0|[1-9]\d{0,19})$/;
function legsOf(req) {
  if (!AMOUNT.test(req.amount)) throw new Error("amount is not a base unit integer");
  const total = BigInt(req.amount);
  const splits = _nullishCoalesce(req.extra.splits, () => ( []));
  if (splits.length > 8) throw new Error("split_count_exceeded");
  let carved = 0n;
  const seen = /* @__PURE__ */ new Set([req.payTo]);
  const legs = [];
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
var SPENDING_LIMIT_USE_DISCRIMINATOR = Uint8Array.from([16, 57, 130, 127, 193, 20, 155, 134]);
var utf8 = (s) => new TextEncoder().encode(s);
function multisigVault(multisig, index = 0) {
  return _web3js.PublicKey.findProgramAddressSync([utf8("multisig"), multisig.toBytes(), utf8("vault"), Uint8Array.from([index])], SQUADS_PROGRAM)[0];
}
function spendingLimitAddress(multisig, createKey) {
  return _web3js.PublicKey.findProgramAddressSync([utf8("multisig"), multisig.toBytes(), utf8("spending_limit"), createKey.toBytes()], SQUADS_PROGRAM)[0];
}
function u64le(v) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}
function spendingLimitUseInstruction(input) {
  const vault = multisigVault(input.multisig, input.vaultIndex);
  const data = new Uint8Array(8 + 8 + 1 + 1);
  data.set(SPENDING_LIMIT_USE_DISCRIMINATOR, 0);
  data.set(u64le(input.amount), 8);
  data[16] = input.decimals;
  data[17] = 0;
  return new (0, _web3js.TransactionInstruction)({
    programId: SQUADS_PROGRAM,
    keys: [
      { pubkey: input.multisig, isSigner: false, isWritable: false },
      { pubkey: input.member, isSigner: true, isWritable: false },
      { pubkey: input.spendingLimit, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: _web3js.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: _spltoken.getAssociatedTokenAddressSync.call(void 0, input.mint, vault, true), isSigner: false, isWritable: true },
      { pubkey: _spltoken.getAssociatedTokenAddressSync.call(void 0, input.mint, input.destination, true), isSigner: false, isWritable: true },
      { pubkey: _spltoken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}
var COMPUTE_UNITS = { transfer: 12e3, guardedLeg: 6e4, base: 4e4 };
var PRIORITY_MICROLAMPORTS = 1;
async function createPayment(seed, req, opts = {}, resource) {
  if (req.scheme !== "exact") throw new Error(`Unsupported scheme ${req.scheme}`);
  if (req.network !== SOLANA_MAINNET) throw new Error(`Unsupported network ${req.network}`);
  const legs = legsOf(req);
  const total = BigInt(req.amount);
  if (opts.maxAmount !== void 0 && total > opts.maxAmount) throw new Error(`The price ${total} is above the limit ${opts.maxAmount} set for this call.`);
  if (opts.allowedSplitRecipients) {
    for (const s of _nullishCoalesce(req.extra.splits, () => ( []))) {
      if (!opts.allowedSplitRecipients.includes(s.payTo)) throw new Error(`Unexpected split recipient ${s.payTo}`);
    }
  }
  const payer = _web3js.Keypair.fromSeed(seed);
  const mint = new (0, _web3js.PublicKey)(req.asset);
  const selfPaid = opts.selfPaid === true;
  const feePayer = selfPaid ? payer.publicKey : new (0, _web3js.PublicKey)(req.extra.feePayer);
  if (!selfPaid && feePayer.equals(payer.publicKey)) throw new Error("The fee payer cannot be the payer.");
  const accepted = selfPaid ? { ...req, extra: { ...req.extra, feePayer: payer.publicKey.toBase58(), sponsored: false } } : req;
  const transfers = [];
  if (opts.guarded) {
    const multisig = new (0, _web3js.PublicKey)(opts.guarded.multisig);
    const spendingLimit = opts.guarded.spendingLimit ? new (0, _web3js.PublicKey)(opts.guarded.spendingLimit) : spendingLimitAddress(multisig, payer.publicKey);
    for (const leg of legs) {
      transfers.push(
        spendingLimitUseInstruction({
          multisig,
          member: payer.publicKey,
          spendingLimit,
          // A guarded wallet is always vault 0 of its Squads account, which is what the facilitator checks.
          vaultIndex: 0,
          mint,
          destination: new (0, _web3js.PublicKey)(leg.payTo),
          amount: leg.amount,
          decimals: USDC_DECIMALS
        })
      );
    }
  } else {
    const source = _spltoken.getAssociatedTokenAddressSync.call(void 0, mint, payer.publicKey, true);
    for (const leg of legs) {
      const destination = _spltoken.getAssociatedTokenAddressSync.call(void 0, mint, new (0, _web3js.PublicKey)(leg.payTo), true);
      transfers.push(_spltoken.createTransferCheckedInstruction.call(void 0, source, mint, destination, payer.publicKey, leg.amount, USDC_DECIMALS));
    }
  }
  const units = COMPUTE_UNITS.base + legs.length * (opts.guarded ? COMPUTE_UNITS.guardedLeg : COMPUTE_UNITS.transfer);
  const memo = _nullishCoalesce(req.extra.memo, () => ( crypto.randomUUID()));
  const blockhash = await _asyncNullishCoalesce(req.extra.recentBlockhash, async () => ( await _optionalChain([opts, 'access', _ => _.getRecentBlockhash, 'optionalCall', _2 => _2()])));
  if (!blockhash) throw new Error("The offer carries no recent blockhash and no way to fetch one was given.");
  const message = new (0, _web3js.TransactionMessage)({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [
      _web3js.ComputeBudgetProgram.setComputeUnitLimit({ units }),
      _web3js.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
      ...transfers,
      new (0, _web3js.TransactionInstruction)({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo, "utf8") })
    ]
  }).compileToV0Message();
  const tx = new (0, _web3js.VersionedTransaction)(message);
  tx.sign([payer]);
  return {
    x402Version: 2,
    ...resource ? { resource } : {},
    accepted,
    payload: { transaction: bytesToBase64(tx.serialize()) }
  };
}
function selectRequirements(required) {
  return _nullishCoalesce(required.accepts.find((a) => a.scheme === "exact" && a.network === SOLANA_MAINNET && a.asset === USDC_MINT), () => ( null));
}






















exports.X402_VERSION = X402_VERSION; exports.SOLANA_MAINNET = SOLANA_MAINNET; exports.USDC_MINT = USDC_MINT; exports.USDC_DECIMALS = USDC_DECIMALS; exports.MEMO_PROGRAM = MEMO_PROGRAM; exports.SQUADS_PROGRAM = SQUADS_PROGRAM; exports.X402_HEADER = X402_HEADER; exports.bytesToBase64 = bytesToBase64; exports.base64ToBytes = base64ToBytes; exports.encodeHeader = encodeHeader; exports.decodeHeader = decodeHeader; exports.legsOf = legsOf; exports.SPENDING_LIMIT_USE_DISCRIMINATOR = SPENDING_LIMIT_USE_DISCRIMINATOR; exports.multisigVault = multisigVault; exports.spendingLimitAddress = spendingLimitAddress; exports.spendingLimitUseInstruction = spendingLimitUseInstruction; exports.COMPUTE_UNITS = COMPUTE_UNITS; exports.PRIORITY_MICROLAMPORTS = PRIORITY_MICROLAMPORTS; exports.createPayment = createPayment; exports.selectRequirements = selectRequirements;
