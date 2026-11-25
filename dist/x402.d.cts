import { PublicKey, TransactionInstruction } from '@solana/web3.js';

/**
 * x402 version 2 on Solana, as Omnia speaks it.
 *
 * The wire format is the public x402 standard: a 402 answer carries a
 * PAYMENT-REQUIRED header, the paid retry carries PAYMENT-SIGNATURE, and the
 * answer to that carries PAYMENT-RESPONSE. Omnia uses the `exact` scheme with
 * the standard `extra.splits` field (section 5 of the Solana scheme), so the
 * publisher and the platform fee wallet are paid by one transaction.
 *
 * A payment leg is either a plain SPL `TransferChecked` signed by the payer,
 * or, for a guarded wallet, a Squads v4 `spendingLimitUse` signed by the
 * agent key. In both cases the payer signs and never needs SOL: the fee payer
 * named in the offer adds its signature and pays the network fee.
 */

declare const X402_VERSION = 2;
declare const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
declare const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
declare const USDC_DECIMALS = 6;
declare const MEMO_PROGRAM: PublicKey;
declare const SQUADS_PROGRAM: PublicKey;
declare const X402_HEADER: {
    readonly required: "payment-required";
    readonly signature: "payment-signature";
    readonly response: "payment-response";
};
interface Split {
    payTo: string;
    /** Absolute amount in base units, carved out of the total. */
    amount: string;
    memo?: string;
}
interface PaymentRequirements {
    scheme: "exact";
    network: string;
    /** The total the payer pays, in base units of `asset`. */
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: {
        /** The wallet that pays the network fee: the relayer for a sponsored payment, the payer itself otherwise. */
        feePayer: string;
        /** False when the relayer does not sponsor this payment and the payer pays its own network fee. Absent means sponsored. */
        sponsored?: boolean;
        memo?: string;
        recentBlockhash?: string;
        lastValidBlockHeight?: string;
        splits?: Split[];
        [key: string]: unknown;
    };
}
interface ResourceInfo {
    url: string;
    description?: string;
    mimeType?: string;
}
interface PaymentRequired {
    x402Version: 2;
    error?: string;
    resource: ResourceInfo;
    accepts: PaymentRequirements[];
}
interface PaymentPayload {
    x402Version: 2;
    resource?: ResourceInfo;
    accepted: PaymentRequirements;
    payload: {
        transaction: string;
    };
}
interface SettlementResponse {
    success: boolean;
    transaction: string;
    network: string;
    payer: string;
    errorReason?: string;
}
declare const bytesToBase64: (bytes: Uint8Array) => string;
declare const base64ToBytes: (b64: string) => Uint8Array;
declare const encodeHeader: (value: unknown) => string;
declare function decodeHeader<T>(value: string): T;
interface Leg {
    payTo: string;
    amount: bigint;
}
/**
 * The transfers a set of requirements asks for, in order: the remainder to
 * `payTo` first, then one per split. Throws when the terms do not add up.
 */
declare function legsOf(req: PaymentRequirements): Leg[];
/** First 8 bytes of sha256("global:spending_limit_use"). */
declare const SPENDING_LIMIT_USE_DISCRIMINATOR: Uint8Array<ArrayBuffer>;
declare function multisigVault(multisig: PublicKey, index?: number): PublicKey;
declare function spendingLimitAddress(multisig: PublicKey, createKey: PublicKey): PublicKey;
interface GuardedSource {
    /** The Squads multisig that owns the vault. */
    multisig: string;
    /** The spending limit account. Omnia derives it from the agent key, so it can be left out. */
    spendingLimit?: string;
}
declare function spendingLimitUseInstruction(input: {
    multisig: PublicKey;
    member: PublicKey;
    spendingLimit: PublicKey;
    vaultIndex: number;
    mint: PublicKey;
    destination: PublicKey;
    amount: bigint;
    decimals: number;
}): TransactionInstruction;
/** Compute units the payment asks for. The network fee does not depend on it, only the priority fee does. */
declare const COMPUTE_UNITS: {
    readonly transfer: 12000;
    readonly guardedLeg: 60000;
    readonly base: 40000;
};
declare const PRIORITY_MICROLAMPORTS = 1;
interface PayOptions {
    /** Pay from a guarded wallet through its Squads spending limit instead of from the agent's own token account. */
    guarded?: GuardedSource;
    /** Refuse to pay more than this, in base units. A guard against a server that changes its price. */
    maxAmount?: bigint;
    /**
     * Build the payment with the payer as its own fee payer, whatever fee payer the offer names. The payer then
     * needs SOL for the network fee. The requirements sent back name the payer as `extra.feePayer`.
     */
    selfPaid?: boolean;
    /** Split recipients the payer accepts. When set, any other split recipient is refused. */
    allowedSplitRecipients?: string[];
    /** Needed only when the offer carries no recent blockhash. */
    getRecentBlockhash?: () => Promise<string>;
}
/**
 * Build and sign the payment transaction for one set of requirements.
 * Returns the PaymentPayload to send in the PAYMENT-SIGNATURE header.
 */
declare function createPayment(seed: Uint8Array, req: PaymentRequirements, opts?: PayOptions, resource?: ResourceInfo): Promise<PaymentPayload>;
/** Pick the first offer this client can pay: `exact`, Solana mainnet, USDC. */
declare function selectRequirements(required: PaymentRequired): PaymentRequirements | null;

export { COMPUTE_UNITS, type GuardedSource, type Leg, MEMO_PROGRAM, PRIORITY_MICROLAMPORTS, type PayOptions, type PaymentPayload, type PaymentRequired, type PaymentRequirements, type ResourceInfo, SOLANA_MAINNET, SPENDING_LIMIT_USE_DISCRIMINATOR, SQUADS_PROGRAM, type SettlementResponse, type Split, USDC_DECIMALS, USDC_MINT, X402_HEADER, X402_VERSION, base64ToBytes, bytesToBase64, createPayment, decodeHeader, encodeHeader, legsOf, multisigVault, selectRequirements, spendingLimitAddress, spendingLimitUseInstruction };
