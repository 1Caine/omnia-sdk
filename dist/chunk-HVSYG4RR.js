// src/x402.ts
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
var X402_VERSION = 2;
var SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
var USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
var USDC_DECIMALS = 6;
var MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
var SQUADS_PROGRAM = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
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
  const splits = req.extra.splits ?? [];
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
  return PublicKey.findProgramAddressSync([utf8("multisig"), multisig.toBytes(), utf8("vault"), Uint8Array.from([index])], SQUADS_PROGRAM)[0];
}
function spendingLimitAddress(multisig, createKey) {
  return PublicKey.findProgramAddressSync([utf8("multisig"), multisig.toBytes(), utf8("spending_limit"), createKey.toBytes()], SQUADS_PROGRAM)[0];
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
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
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
    for (const s of req.extra.splits ?? []) {
      if (!opts.allowedSplitRecipients.includes(s.payTo)) throw new Error(`Unexpected split recipient ${s.payTo}`);
    }
  }
  const payer = Keypair.fromSeed(seed);
  const mint = new PublicKey(req.asset);
  const feePayer = new PublicKey(req.extra.feePayer);
  if (feePayer.equals(payer.publicKey)) throw new Error("The fee payer cannot be the payer.");
  const transfers = [];
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
          decimals: USDC_DECIMALS
        })
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
  const blockhash = req.extra.recentBlockhash ?? await opts.getRecentBlockhash?.();
  if (!blockhash) throw new Error("The offer carries no recent blockhash and no way to fetch one was given.");
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
      ...transfers,
      new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo, "utf8") })
    ]
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  return {
    x402Version: 2,
    ...resource ? { resource } : {},
    accepted: req,
    payload: { transaction: bytesToBase64(tx.serialize()) }
  };
}
function selectRequirements(required) {
  return required.accepts.find((a) => a.scheme === "exact" && a.network === SOLANA_MAINNET && a.asset === USDC_MINT) ?? null;
}

export {
  X402_VERSION,
  SOLANA_MAINNET,
  USDC_MINT,
  USDC_DECIMALS,
  MEMO_PROGRAM,
  SQUADS_PROGRAM,
  X402_HEADER,
  bytesToBase64,
  base64ToBytes,
  encodeHeader,
  decodeHeader,
  legsOf,
  SPENDING_LIMIT_USE_DISCRIMINATOR,
  multisigVault,
  spendingLimitAddress,
  spendingLimitUseInstruction,
  COMPUTE_UNITS,
  PRIORITY_MICROLAMPORTS,
  createPayment,
  selectRequirements
};
