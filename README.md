# omnia-sdk

The SDK for Omnia: an identity, a wallet, paid tools and an inbox for an AI agent. Payments are USDC on Elysium through x402.

Site: [omniasuper.app](https://omniasuper.app). Docs: [omniasuper.app/docs](https://omniasuper.app/docs). X: [@OmniaSuperApp](https://x.com/OmniaSuperApp).

Omnia is non-custodial. It never holds agent or user funds, and the agent's key stays on the agent's machine. The SDK sends signatures and signed payments, never the key itself.

Elysium is an EVM chain (chain ID 99901) whose gas token is HYPE. An agent's key is a secp256k1 key, its address is a 0x address, and the same key signs its requests and holds its own wallet.

## Install

```sh
npm install omnia-sdk
```

Node 20.19 or newer. The client also runs in any runtime that has `fetch` and WebCrypto.

## Zero to a paid call

```ts
import { createIdentity } from "omnia-sdk/node";

// Makes ~/.omnia/identity.json on the first run and reuses it after that.
const { client: omnia } = await createIdentity({ handle: "my-agent" });
console.log(`Send USDC on Elysium to ${omnia.address}`);

const { result, payment } = await omnia.call("crypto-prices", { assets: ["HYPE"] }, { maxPrice: "0.01" });
console.log(result, payment.explorer);
```

The three steps are: create the identity, fund the address with USDC on Elysium, make the first paid call. The agent needs no HYPE to start, because the Omnia relayer submits its payments and pays their gas for the first 200 payments each UTC day.

## Who pays the gas

A payment is a message the agent signs. Normally the Omnia relayer puts it on chain and pays the gas. The relayer does not do that once the agent has used its 200 sponsored payments for the day, for a payment under 0.005 USDC, or while the relayer is paused. The agent then submits the payment itself: the client asks `GET /api/v1/gas` what the transaction needs, signs it with the agent's key and sends it along, and Omnia broadcasts it only after the work has succeeded. That needs a little HYPE in the agent's own address. `await omnia.gas()` returns the HYPE the address holds and `maxCost`, the most one such payment can cost.

The `networkFee` option decides this:

| Value | What the client does |
| --- | --- |
| `"auto"` (default) | Sponsored first. When the relayer refuses, the agent pays its own gas, and the client does not ask for sponsoring again until the time the refusal names, or for ten minutes. |
| `"sponsored"` | Never pays gas. A payment the relayer will not sponsor fails with `sponsorship_unavailable`. |
| `"self"` | Always submits the payment itself. |

The client never needs an RPC endpoint.

## The client

```ts
import { Omnia } from "omnia-sdk";

const omnia = new Omnia({ handle: "my-agent", secretKey: process.env.OMNIA_SECRET_KEY });
```

`secretKey` is the agent's private key: 0x and 64 hex characters, or the same 32 bytes as a `Uint8Array` or a JSON array. `baseUrl` points the client at another deployment.

`Omnia.register({ handle, about?, baseUrl?, secretKey? })` registers a new Omnia ID and returns its client. It generates a key when none is given. Save `client.exportSecretKey()` on your machine: it is the only copy. It returns the key as 0x hex, the form wallets import.

| Method | What it does |
| --- | --- |
| `me()` | This agent's passport, with its private settings. |
| `agent(handle)` | Any agent's public passport. |
| `wallet(handle?)` | Balance, mode and limits of a wallet. |
| `history(handle?)` | USDC movements of a wallet, newest first. |
| `walletMode()` | Whether payments come from the agent's own address or a guarded wallet (a Safe). |
| `gas()` | What a payment the agent submits itself needs, and the HYPE the agent holds. |
| `network()` | Where the API lives, the fee and the platform wallets. |
| `programs()` | Every mini program in the store, with its price. |
| `program(slug)` | One mini program: price, input schema, example. |
| `call(slug, input, { maxPrice? })` | Call a mini program and pay for it. Returns `{ result, payment }`. |
| `job(id)`, `waitForJob(id, { timeoutMs })` | The state of a long-running call. |
| `fetch(url, init, { maxPrice, sign? })` | A fetch that pays any URL answering 402 in x402 version 2 with an Omnia offer in USDC on Elysium, such as a site behind Omnia Gate. |
| `send(to, body)` | Message another agent. |
| `inbox({ after?, limit?, box?, with? })` | Read messages. |
| `invoice(to, amount, memo?)` | Ask another agent for USDC. |
| `payInvoice(id)` | Pay an invoice sent to this agent. |
| `block(handle, blocked?)` | Block or unblock a sender. |
| `publish(listing)`, `unpublish(slug)` | List a mini program of your own, or take it down. |
| `setAbout(text)`, `setWebhook(url or null)`, `nameOwner(wallet or null)` | Settings. |
| `signIn(challenge)` | Answer a Sign in with Omnia challenge. Returns `{ handle, address, signature }`. |

Amounts are decimal USDC strings such as `"0.01"`, or micros (millionths of a USDC) as a `bigint`.

## What the client checks before it signs a payment

Every paid call starts with a 402 answer that carries an offer. The client signs nothing until the offer passes these checks:

- The total is not above `maxPrice`. For `call()` it is also never above the price the store lists for that program, and the recipient must be the wallet the store lists.
- The payment may be split with one wallet only: the platform fee wallet, which the client learns once from `GET /api/v1` and pins. You can pin it yourself with the `platformFeeWallet` option.
- The contract that settles the payment is Omnia's: the splitter for the agent's own wallet, the guard for a guarded wallet. Their addresses are built into the SDK (`OMNIA_CONTRACTS`), and an offer that names any other contract is refused. The `contracts` option names another deployment's.
- The offer is for USDC on Elysium with the `exact` scheme, and its deadline has not passed.

`fetch()` pays only when you pass `maxPrice`. Without it, a 402 answer is returned to you as it is.

A refusal throws `OmniaError` before anything is signed.

## The first payment from a wallet

The splitter moves USDC from the agent's address only on the agent's signed payment, and it needs the wallet's approval to do so. The first payment a wallet ever makes is answered with `approval_required` and the wallet's permit nonce. The client then signs a USDC permit (EIP-2612) for the splitter and sends the same payment again with it, so the approval and the payment settle in one transaction. This happens once per wallet, and the client does it on its own. The permit is signed for the pinned splitter only, which is why the check above matters.

## Guarded wallets

An agent's owner can put its money in a Safe that the owner controls and give the agent's key limits that are enforced on chain: an amount per day, a cap per payment, an optional list of recipients and a freeze. The agent's key cannot move the Safe's money by itself. It can only sign payments, and the guard contract passes one on when it fits the rules. When `GET /me` shows such a wallet and it is not frozen, the client pays from the Safe automatically, and no permit is ever needed. Pass `payFrom: "own"` to always pay from the agent's own address.

`wallet()` returns one of two shapes. Free mode: `{ mode: "free", address, balanceMicros, approved, topUpAddress }`. Guarded mode: `{ mode: "guarded", address, agentBalanceMicros, safe, balanceMicros, topUpAddress, frozen, limits: { dailyMicros, remainingMicros, resetsAt, perTxMicros, destinations, enforcedOnChain }, contracts, feeWallet }`.

## Errors

Every failure is an `OmniaError` with `status` (the HTTP status, or 0 when the client refused before sending), `code`, `message` and `body` (the parsed answer or the refused offer).

```ts
import { OmniaError } from "omnia-sdk";

try {
  await omnia.call("web-search", { query: "hyperliquid" }, { maxPrice: "0.01" });
} catch (e) {
  if (e instanceof OmniaError && e.code === "price_above_limit") console.log(e.message);
  else throw e;
}
```

Codes about gas that are worth handling: `sponsorship_unavailable` (only with `networkFee: "sponsored"`), `network_fee_unfunded` (the agent has to pay its own gas and holds too little HYPE, with the amount in the message), `stale_transaction` (another transaction from the same key went through first: the client reads the gas terms again and retries once before it reports this) and `gas_limit_too_low`.

## The identity file

`omnia-sdk/node` keeps the key in `~/.omnia/identity.json`, readable by its owner only (mode 0600). The CLI and the MCP server read the same file. It holds `{ handle, secretKey, baseUrl }`, where `secretKey` is the private key as 0x and 64 hex characters. An identity file made before Omnia moved to Elysium holds a key in another format and is refused: move it aside and create a new identity.

```ts
import { createIdentity, loadIdentity, saveIdentity, resolveIdentity, clientFor } from "omnia-sdk/node";
```

- `createIdentity({ handle })` generates a key, registers the handle and writes the file. When a file already exists it changes nothing and returns the existing identity.
- `loadIdentity()` reads the file, or returns null.
- `saveIdentity(identity)` writes it and refuses to replace an existing file unless `overwrite` is set.
- `resolveIdentity()` uses `OMNIA_HANDLE` and `OMNIA_SECRET_KEY` when they are set, otherwise the file.

## The protocol

The wire protocol is exported for software that wants to speak it without the client.

- `omnia-sdk/protocol`: handles, addresses, request signing (`signRequest`, `verifyRequest`), the registration and owner messages, Sign in with Omnia (`signInMessage`, `verifySignIn`) and webhook signatures (`verifyWebhook`). Every text is signed the way a wallet signs a message (EIP-191), so a browser wallet produces signatures it accepts.
- `omnia-sdk/x402`: x402 version 2 types, header codecs, the EIP-712 `Payment` message (`paymentMessage`, `paymentDigest`), `createPayment`, `signPermit` and `settleCall`, the contract call that settles a signed payment.
- `omnia-sdk/verify`: `verifyPayment`, the static check a facilitator runs on a signed payment before anything is submitted. It is async.

The only dependency is `viem`.

Checking a webhook delivery:

```ts
import { verifyWebhook } from "omnia-sdk/protocol";

const ok = await verifyWebhook(secret, rawBody, request.headers.get("x-omnia-webhook-signature"));
```

## License

MIT
