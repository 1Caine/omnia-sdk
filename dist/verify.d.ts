import { Hex } from 'viem';
import { Leg, SignedPayment, PaymentRequirements } from './x402.js';

/**
 * Static verification of an x402 payment, as the Omnia facilitator runs it
 * before it submits anything.
 *
 * A payment comes in one of two shapes. Sponsored: the payer sends its signed
 * `Payment` message and the relayer submits it and pays the gas. Self-paid:
 * the payer also sends a transaction it has signed itself, which calls the
 * settling contract with that same message, and the relayer signs nothing and
 * spends nothing.
 *
 * Everything here is pure: a payload in, a verdict out. It proves who signed,
 * and that what was signed is exactly the transfers the charge asks for. The
 * facilitator then simulates the call against the chain, which is what proves
 * the money is there and, for a guarded wallet, that its limits allow it.
 */

/** What the relayer is prepared to submit. */
declare const SPONSOR_LIMITS: {
    readonly maxSplits: 1;
    readonly maxMemoBytes: 256;
    /** How far past the offer's window a deadline may be, to allow for clocks that differ. */
    readonly clockSkewSeconds: 30;
};
/** The most gas a self-paid transaction may ask for. A payment uses well under half of this. */
declare const SELF_PAID_GAS_LIMIT = 1500000n;
type VerifyReason = "unsupported_scheme" | "unsupported_network" | "unsupported_asset" | "invalid_requirements" | "split_count_exceeded" | "invalid_payload" | "expired" | "deadline_too_far" | "signature_mismatch" | "invalid_permit" | "invalid_transaction" | "transaction_mismatch";
interface VerifiedPayment {
    ok: true;
    /** The payment's number: the hash of the offer's memo. It can settle once. */
    paymentId: Hex;
    /** The agent key that signed. */
    signer: string;
    /** Whose USDC moves: the signer itself, or its guarded wallet. */
    payer: string;
    source: "wallet" | "guarded";
    /** The Safe, for a guarded payment. */
    safe: string | null;
    legs: Leg[];
    total: bigint;
    /** The call that settles the payment. */
    call: {
        to: `0x${string}`;
        data: Hex;
    };
    /** True when the payload carries the one-time approval of the splitter. */
    withPermit: boolean;
    /** The payer's own signed transaction, when the payer pays its own gas. Null for a sponsored payment. */
    selfPaid: {
        raw: Hex;
        hash: Hex;
        gas: bigint;
        maxFeePerGas: bigint;
        nonce: number;
    } | null;
}
type VerifyResult = VerifiedPayment | {
    ok: false;
    reason: VerifyReason;
    detail?: string;
};
/**
 * Check a signed payment against the requirements the facilitator rebuilt from its own charge.
 * `req.extra.validBefore` is the deadline the payer signed, taken from the payload: it is checked here.
 */
declare function verifyPayment(signed: SignedPayment, req: PaymentRequirements, opts?: {
    maxSplits?: number;
    now?: number;
}): Promise<VerifyResult>;

export { SELF_PAID_GAS_LIMIT, SPONSOR_LIMITS, type VerifiedPayment, type VerifyReason, type VerifyResult, verifyPayment };
