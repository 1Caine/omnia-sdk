// src/x402.ts
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, getAddress, hashTypedData, keccak256, parseSignature, recoverTypedDataAddress, toBytes } from "viem";
var X402_VERSION = 2;
var ELYSIUM_CHAIN_ID = 99901;
var ELYSIUM = `eip155:${ELYSIUM_CHAIN_ID}`;
var USDC_ADDRESS = "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65";
var USDC_DECIMALS = 6;
var USDC_PERMIT_DOMAIN = { name: "USDC", version: "1", chainId: ELYSIUM_CHAIN_ID, verifyingContract: USDC_ADDRESS };
var MAX_LEGS = 8;
var MAX_UINT256 = (1n << 256n) - 1n;
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
var encodeHeader = (value) => b64encode(JSON.stringify(value));
function decodeHeader(value) {
  return JSON.parse(b64decode(value));
}
var AMOUNT = /^(0|[1-9]\d{0,19})$/;
var ADDRESS = /^0x[0-9a-fA-F]{40}$/;
function legsOf(req) {
  if (!AMOUNT.test(req.amount)) throw new Error("amount is not a base unit integer");
  if (!ADDRESS.test(req.payTo)) throw new Error("payTo is not an address");
  const total = BigInt(req.amount);
  const splits = req.extra.splits ?? [];
  if (splits.length > MAX_LEGS - 1) throw new Error("split_count_exceeded");
  let carved = 0n;
  const seen = /* @__PURE__ */ new Set([req.payTo.toLowerCase()]);
  const legs = [];
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
var PAYMENT_TYPES = {
  Payment: [
    { name: "payer", type: "address" },
    { name: "token", type: "address" },
    { name: "to", type: "address[]" },
    { name: "amounts", type: "uint256[]" },
    { name: "nonce", type: "bytes32" },
    { name: "validBefore", type: "uint256" }
  ]
};
var PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};
var PAYMENT_TUPLE = {
  type: "tuple",
  name: "p",
  components: [
    { name: "payer", type: "address" },
    { name: "token", type: "address" },
    { name: "to", type: "address[]" },
    { name: "amounts", type: "uint256[]" },
    { name: "nonce", type: "bytes32" },
    { name: "validBefore", type: "uint256" }
  ]
};
var PAID_EVENT_INPUTS = (second) => [
  { name: "nonce", type: "bytes32", indexed: true },
  { name: second, type: "address", indexed: true },
  { name: second === "payer" ? "token" : "agent", type: "address", indexed: true },
  { name: "to", type: "address[]", indexed: false },
  { name: "amounts", type: "uint256[]", indexed: false }
];
var SPLITTER_ABI = [
  { type: "function", name: "pay", stateMutability: "nonpayable", inputs: [PAYMENT_TUPLE, { name: "signature", type: "bytes" }], outputs: [] },
  {
    type: "function",
    name: "payWithPermit",
    stateMutability: "nonpayable",
    inputs: [PAYMENT_TUPLE, { name: "signature", type: "bytes" }, { name: "permitValue", type: "uint256" }, { name: "permitDeadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }],
    outputs: []
  },
  { type: "function", name: "used", stateMutability: "view", inputs: [{ name: "payer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "event", name: "Paid", inputs: PAID_EVENT_INPUTS("payer") },
  { type: "error", name: "Expired", inputs: [] },
  { type: "error", name: "BadLegs", inputs: [] },
  { type: "error", name: "NonceUsed", inputs: [] },
  { type: "error", name: "BadSignature", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] }
];
var GUARD_ABI = [
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
    outputs: [{ name: "agent", type: "address" }, { name: "perPayment", type: "uint96" }, { name: "frozen", type: "bool" }, { name: "restricted", type: "bool" }]
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
  { type: "error", name: "BadSignature", inputs: [] }
];
var paymentNonce = (memo) => keccak256(toBytes(memo));
function paymentDomain(name, verifyingContract) {
  return { name, version: "1", chainId: ELYSIUM_CHAIN_ID, verifyingContract: getAddress(verifyingContract) };
}
function paymentMessage(req, payer) {
  const legs = legsOf(req);
  if (!/^\d{1,12}$/.test(String(req.extra.validBefore ?? ""))) throw new Error("The offer carries no deadline.");
  if (typeof req.extra.memo !== "string" || req.extra.memo.length === 0 || req.extra.memo.length > 256) throw new Error("The offer carries no memo.");
  return {
    payer: getAddress(payer),
    token: getAddress(req.asset),
    to: legs.map((l) => getAddress(l.payTo)),
    amounts: legs.map((l) => l.amount),
    nonce: paymentNonce(req.extra.memo),
    validBefore: BigInt(req.extra.validBefore)
  };
}
function settlerOf(req, guarded) {
  const address = guarded ? req.extra.guard : req.extra.splitter;
  if (typeof address !== "string" || !ADDRESS.test(address)) throw new Error("The offer does not name the contract that settles it.");
  return { address: getAddress(address), domain: paymentDomain(guarded ? "Omnia Guard" : "Omnia Splitter", address) };
}
function paymentDigest(req, payer, guarded) {
  return hashTypedData({ domain: settlerOf(req, guarded).domain, types: PAYMENT_TYPES, primaryType: "Payment", message: paymentMessage(req, payer) });
}
async function recoverPaymentSigner(req, payer, guarded, signature) {
  return recoverTypedDataAddress({ domain: settlerOf(req, guarded).domain, types: PAYMENT_TYPES, primaryType: "Payment", message: paymentMessage(req, payer), signature });
}
function settleCall(req, signed, guarded) {
  const message = paymentMessage(req, signed.payer);
  const to = settlerOf(req, guarded).address;
  if (guarded) return { to, data: encodeFunctionData({ abi: GUARD_ABI, functionName: "pay", args: [message, signed.signature] }) };
  if (!signed.permit) return { to, data: encodeFunctionData({ abi: SPLITTER_ABI, functionName: "pay", args: [message, signed.signature] }) };
  const sig = parseSignature(signed.permit.signature);
  const v = sig.v !== void 0 ? Number(sig.v) : 27 + Number(sig.yParity);
  return {
    to,
    data: encodeFunctionData({ abi: SPLITTER_ABI, functionName: "payWithPermit", args: [message, signed.signature, BigInt(signed.permit.value), BigInt(signed.permit.deadline), v, sig.r, sig.s] })
  };
}
async function signPermit(seed, spender, request, now = Math.floor(Date.now() / 1e3)) {
  const account = privateKeyToAccount(`0x${[...seed].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  const deadline = BigInt(now + (request.ttlSeconds ?? 3600));
  const signature = await account.signTypedData({
    domain: USDC_PERMIT_DOMAIN,
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: account.address, spender: getAddress(spender), value: MAX_UINT256, nonce: BigInt(request.nonce), deadline }
  });
  return { value: MAX_UINT256.toString(), deadline: deadline.toString(), signature };
}
async function createPayment(seed, req, opts = {}, resource) {
  if (req.scheme !== "exact") throw new Error(`Unsupported scheme ${req.scheme}`);
  if (req.network !== ELYSIUM) throw new Error(`Unsupported network ${req.network}`);
  if (req.asset.toLowerCase() !== USDC_ADDRESS.toLowerCase()) throw new Error(`Unsupported asset ${req.asset}`);
  const total = BigInt(req.amount);
  if (opts.maxAmount !== void 0 && total > opts.maxAmount) throw new Error(`The price ${total} is above the limit ${opts.maxAmount} set for this call.`);
  if (opts.allowedSplitRecipients) {
    const allowed = opts.allowedSplitRecipients.map((a) => a.toLowerCase());
    for (const s of req.extra.splits ?? []) {
      if (!allowed.includes(s.payTo.toLowerCase())) throw new Error(`Unexpected split recipient ${s.payTo}`);
    }
  }
  const now = opts.now ?? Math.floor(Date.now() / 1e3);
  if (Number(req.extra.validBefore) <= now) throw new Error("The offer has expired. Ask for a new one.");
  const account = privateKeyToAccount(`0x${[...seed].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  const guarded = opts.guarded !== void 0;
  const payer = guarded ? getAddress(opts.guarded.safe) : account.address;
  const settler = settlerOf(req, guarded);
  const signature = await account.signTypedData({ domain: settler.domain, types: PAYMENT_TYPES, primaryType: "Payment", message: paymentMessage(req, payer) });
  const permit = !guarded && opts.permit ? await signPermit(seed, settler.address, opts.permit, now) : void 0;
  return {
    x402Version: 2,
    ...resource ? { resource } : {},
    accepted: req,
    payload: { payer, signer: account.address, signature, ...permit ? { permit } : {} }
  };
}
function selectRequirements(required) {
  return required.accepts.find((a) => a.scheme === "exact" && a.network === ELYSIUM && typeof a.asset === "string" && a.asset.toLowerCase() === USDC_ADDRESS.toLowerCase()) ?? null;
}

export {
  X402_VERSION,
  ELYSIUM_CHAIN_ID,
  ELYSIUM,
  USDC_ADDRESS,
  USDC_DECIMALS,
  USDC_PERMIT_DOMAIN,
  MAX_LEGS,
  X402_HEADER,
  encodeHeader,
  decodeHeader,
  legsOf,
  PAYMENT_TYPES,
  PERMIT_TYPES,
  SPLITTER_ABI,
  GUARD_ABI,
  paymentNonce,
  paymentDomain,
  paymentMessage,
  settlerOf,
  paymentDigest,
  recoverPaymentSigner,
  settleCall,
  signPermit,
  createPayment,
  selectRequirements
};
