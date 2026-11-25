import { VersionedTransaction } from '@solana/web3.js';
import { Leg, PaymentRequirements } from './x402.cjs';

/**
 * Static verification of an x402 payment transaction, as the Omnia
 * facilitator runs it before it adds the fee payer's signature.
 *
 * A payment comes in one of two shapes. Sponsored: the relayer is the fee
 * payer and the agent is the second signer. Self-paid: the agent is the fee
 * payer and the only signer, and the relayer signs nothing and spends nothing.
 *
 * Everything here is pure: bytes in, verdict out. It follows the static
 * layout of the `exact` Solana scheme with splits (section 5.7): compute
 * budget, compute price, one transfer per leg in order, then a memo. A leg
 * is an SPL `TransferChecked` or a Squads v4 `spendingLimitUse`.
 *
 * The facilitator then simulates the transaction against the chain, which is
 * what proves the money is really there and the spending limit allows it.
 */

/** What the fee payer is prepared to sponsor. */
declare const SPONSOR_LIMITS: {
    readonly maxComputeUnits: 400000;
    /** The priority fee the fee payer pays is units x price. This cap keeps it under 0.00004 SOL. */
    readonly maxMicroLamportsPerUnit: 100;
    readonly maxSplits: 1;
    readonly maxMemoBytes: 256;
};
type VerifyReason = "unsupported_scheme" | "unsupported_network" | "invalid_requirements" | "split_count_exceeded" | "invalid_transaction" | "unsupported_transaction_version" | "address_lookup_tables_not_allowed" | "fee_payer_mismatch" | "fee_payer_in_instruction" | "too_many_signers" | "payer_signature_missing" | "instruction_order" | "compute_limit_too_high" | "compute_price_too_high" | "unknown_instruction" | "leg_unmatched" | "leg_amount_mismatch" | "leg_recipient_mismatch" | "leg_asset_mismatch" | "mixed_sources" | "memo_mismatch" | "memo_too_long";
interface VerifiedPayment {
    ok: true;
    /** The key that signed the payment: the agent. */
    signer: string;
    /** Where the money comes from: the agent's own wallet, or a guarded wallet's vault. */
    source: "wallet" | "guarded";
    /** The account the USDC leaves: the signer, or the Squads vault. */
    payer: string;
    /** Set for guarded payments. */
    multisig: string | null;
    spendingLimit: string | null;
    legs: Leg[];
    total: bigint;
    memo: string | null;
    /** The signer's signature over the message. Unique per payment, used to refuse a replay. */
    paymentId: string;
    transaction: VersionedTransaction;
}
type VerifyResult = VerifiedPayment | {
    ok: false;
    reason: VerifyReason;
    detail?: string;
};
/** The fee payer of a serialized payment transaction: its first account. Null when the bytes are not a version 0 transaction. */
declare function feePayerOf(transactionBase64: string): string | null;
/**
 * `selfPaid` checks the shape in which the payer is its own fee payer: one signer, which is both. The
 * requirements must then name that payer as `extra.feePayer`.
 */
declare function verifyPayment(transactionBase64: string, req: PaymentRequirements, expect: {
    feePayer: string;
    maxSplits?: number;
    selfPaid?: boolean;
}): VerifyResult;

export { SPONSOR_LIMITS, type VerifiedPayment, type VerifyReason, type VerifyResult, feePayerOf, verifyPayment };
