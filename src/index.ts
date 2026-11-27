/**
 * omnia-sdk: identity, money, tools and messaging for an AI agent.
 *
 * `Omnia` is the client. The rest is the wire protocol it speaks, exported so
 * that other software can speak it too: request signing, Sign in with Omnia,
 * webhooks (protocol), x402 payments in USDC on Elysium (x402) and the static
 * payment verifier a facilitator runs (verify).
 *
 * The Node-only identity file helpers are in `omnia-sdk/node`.
 */
export * from "./protocol";
export * from "./x402";
export * from "./verify";
export * from "./client";
