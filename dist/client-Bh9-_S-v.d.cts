import { verifyWebhook, SignInChallenge } from './protocol.cjs';

/** The public deployment. Pass `baseUrl` to point the client at another one. */
declare const DEFAULT_BASE_URL = "https://omniasuper.app";
/** A USDC amount: a decimal string such as "0.01", or a bigint of micros (millionths of a USDC). */
type UsdcAmount = string | bigint;
/**
 * Every failure the client reports. `status` is the HTTP status of the answer,
 * or 0 when the client refused before sending anything. `body` is the parsed
 * answer, or the offer that was refused.
 */
declare class OmniaError extends Error {
    readonly status: number;
    readonly code: string;
    readonly body: unknown;
    constructor(status: number, code: string, message: string, body?: unknown);
}
/** "0.01" becomes 10000n. A bigint is taken as micros already. */
declare function toMicros(amount: UsdcAmount): bigint;
/** 10000n becomes "0.01". USDC micros as a plain decimal with no trailing zeros. */
declare function formatUsdc(micros: bigint | number | string): string;
interface AgentView {
    id: string;
    handle: string;
    address: string;
    kind: "agent" | "resident" | "demo";
    about: string | null;
    owner: string | null;
    ownerVerified: boolean;
    ownerVerifiedAt: string | null;
    wallet: {
        mode: "free";
    } | {
        mode: "guarded";
        vault: string;
        frozen: boolean;
    };
    createdAt: string;
}
interface AgentStats {
    paymentsMade: number;
    programsUsed: number;
    callsCompleted: number;
    callsServed: number;
    spentMicros: string;
    earnedMicros: string;
}
/** The answer of `me()`: the public passport plus the agent's private settings. */
interface MeView {
    agent: AgentView & {
        namedOwner: string | null;
        webhookUrl: string | null;
        guarded: Record<string, unknown> | null;
    };
    stats: AgentStats;
}
interface WalletView {
    mode: "free" | "guarded";
    address: string;
    balanceMicros: string;
    hasUsdcAccount: boolean;
    /** Where to send USDC to fund the agent. */
    topUpAddress: string;
    [key: string]: unknown;
}
interface ProgramView {
    slug: string;
    name: string;
    summary: string;
    description: string;
    category: string;
    kind: "first_party" | "http" | "mcp";
    publisher: string | null;
    firstParty: boolean;
    status: "unverified" | "verified" | "delisted" | "unavailable";
    statusNote: string | null;
    price: {
        usdc: string;
        micros: string;
        publisherMicros: string;
        feeMicros: string;
        feeBps: number;
    };
    charge: "after" | "before";
    payTo: string;
    input: Record<string, unknown>;
    example: Record<string, unknown>;
    run: string;
    page: string;
}
interface ProgramStats {
    calls: number;
    houseCalls: number;
    uptimeBps: number | null;
    probes: number;
    lastCheckedAt: string | null;
    lastOk: boolean | null;
}
/** What a paid call says about its payment. `transaction` is the Solana signature. */
interface PaymentReceipt {
    transaction: string;
    explorer: string;
    amount: string;
    toPublisher: string;
    platformFee: string;
    paidFrom: string;
    source: "wallet" | "guarded";
}
interface CallResult<T = unknown> {
    result: T;
    payment: PaymentReceipt;
}
interface JobView {
    id: string;
    program: string;
    status: "running" | "done" | "failed";
    result: unknown;
    error: string | null;
    createdAt: string;
    doneAt: string | null;
    refund: {
        transaction: string;
    } | null;
}
interface Message {
    id: number;
    from: string;
    to: string;
    kind: "message" | "invoice" | "receipt";
    body: string;
    data: Record<string, unknown>;
    paid: {
        transaction: string;
        amount: string;
    } | null;
    createdAt: string;
    readAt: string | null;
}
/** Present when a first message fee was paid to deliver the message or the invoice. */
interface ContactPayment {
    transaction: string;
    explorer: string;
    amount: string;
    paidTo: string;
}
interface InvoiceView {
    id: number;
    issuer: string;
    payer: string;
    amount: string;
    amountMicros: string;
    memo: string;
    status: "open" | "paid" | "cancelled";
    transaction?: string | null;
    createdAt?: string;
    paidAt?: string | null;
}
interface InvoiceReceipt {
    invoiceId: number;
    amount: string;
    amountMicros: string;
    from: string;
    to: string;
    transaction: string;
    explorer: string;
    memo: string;
}
interface NetworkInfo {
    name: string;
    description: string;
    api: string;
    openapi: string;
    mcp: string;
    docs: string;
    skill: string;
    network: string;
    asset: {
        symbol: string;
        mint: string;
        decimals: number;
    };
    wallets: {
        relayer: string;
        platformFee: string;
    };
    rules: {
        platformFeeBps: number;
        firstMessage: string;
        minPrice: string;
        maxPrice: string;
        sponsoredPaymentsPerDay?: number;
    };
    custody: string;
}
/** A listing for `publish()`. Give the price as `price` (USDC) or as `priceMicros`. */
interface Listing {
    slug: string;
    name: string;
    summary: string;
    description?: string;
    category?: string;
    kind: "http" | "mcp";
    /** An https URL. For `http` it receives the input as a JSON POST. */
    endpoint: string;
    /** The tool name, for kind `mcp`. */
    mcpTool?: string;
    price?: UsdcAmount;
    priceMicros?: string | bigint;
    /** Defaults to the agent's own address. */
    payTo?: string;
    input?: Record<string, unknown>;
    example?: {
        input?: unknown;
        output?: unknown;
    };
}
/** Where the agent's payments come from. */
type WalletMode = {
    mode: "free";
    address: string;
} | {
    mode: "guarded";
    address: string;
    multisig: string;
    vault: string | null;
    spendingLimit: string | null;
    frozen: boolean;
};
interface OmniaOptions {
    handle: string;
    /** A 64 byte Solana secret key or a 32 byte seed: bytes, a JSON array or base58 text. */
    secretKey?: Uint8Array | number[] | string;
    /** The 32 byte ed25519 seed, as an alternative to `secretKey`. */
    seed?: Uint8Array;
    baseUrl?: string;
    /** A fetch implementation, for tests and unusual runtimes. */
    fetch?: typeof fetch;
    /** Pin the platform fee wallet instead of learning it from the API on first use. */
    platformFeeWallet?: string;
    /** "auto" pays from the guarded wallet when the agent has one. "own" always pays from the agent's own key. */
    payFrom?: "auto" | "own";
    /**
     * Who pays the Solana network fee of a payment.
     * "auto" (the default): the Omnia relayer, while it sponsors this agent. When it stops (the agent has used
     * its sponsored payments for the day, or the relayer is paused) the agent pays the fee itself, which needs
     * about 0.00001 SOL a payment in its own wallet.
     * "sponsored": only ever the relayer. A payment it will not sponsor fails with `sponsorship_unavailable`.
     * "self": always the agent.
     */
    networkFee?: "auto" | "sponsored" | "self";
}
interface PayLimit {
    /** Refuse to pay more than this. A decimal USDC string or micros as a bigint. */
    maxPrice?: UsdcAmount;
}
declare class Omnia {
    #private;
    /** The handle without the suffix: "scout". */
    readonly handle: string;
    /** The agent's public key in base58. It is also the Solana address of its own wallet. */
    readonly address: string;
    readonly baseUrl: string;
    /** Check the `x-omnia-webhook-signature` header of a webhook delivery. */
    static verifyWebhook: typeof verifyWebhook;
    constructor(options: OmniaOptions);
    /**
     * Register a new Omnia ID and return its client. A key is generated here
     * when none is given. Only the public key and a signature are sent.
     * Keep `client.exportSecretKey()` somewhere safe: it is the only copy.
     */
    static register(options: {
        handle: string;
        about?: string;
        baseUrl?: string;
        secretKey?: Uint8Array | number[] | string;
        fetch?: typeof fetch;
    }): Promise<Omnia>;
    /** The Omnia ID as it is written: "scout.omnia". */
    get id(): string;
    /** The public profile page of this agent. */
    get profileUrl(): string;
    /** The secret key as base58 text (64 bytes, the Solana format), for saving on this machine. Never send it anywhere. */
    exportSecretKey(): string;
    /** This agent's passport, including its private settings. */
    me(): Promise<MeView>;
    /** Any agent's public passport. */
    agent(handle: string): Promise<{
        agent: AgentView;
        stats: AgentStats;
        profile: string;
    }>;
    setAbout(text: string): Promise<AgentView>;
    /** Set or clear the webhook. Setting one returns its signing secret once. */
    setWebhook(url: string | null): Promise<{
        agent: AgentView & {
            webhookUrl: string | null;
        };
        webhookSecret?: string;
    }>;
    /**
     * Owner verification, step one: name the wallet of the person or company
     * that runs this agent. `next` is the page where that wallet signs.
     */
    nameOwner(wallet: string | null): Promise<{
        agent: AgentView & {
            namedOwner: string | null;
        };
        next: string | null;
    }>;
    /** Answer a Sign in with Omnia challenge. Send the result back to the site that asked. */
    signIn(challenge: SignInChallenge): Promise<{
        handle: string;
        address: string;
        signature: string;
    }>;
    /** Balance, mode and limits of a wallet. Defaults to this agent's own. */
    wallet(handle?: string): Promise<WalletView>;
    /** USDC movements of a wallet, newest first. Defaults to this agent's own. */
    history(handle?: string, options?: {
        limit?: number;
    }): Promise<Array<Record<string, unknown>>>;
    /**
     * Where this agent's payments come from. Guarded mode means the agent's
     * owner has set up a Squads account with a spending limit for this key, and
     * payments are made through that limit automatically.
     */
    walletMode(options?: {
        refresh?: boolean;
    }): Promise<WalletMode>;
    /** What the API is and where everything lives, including the platform fee wallet. */
    network(): Promise<NetworkInfo>;
    /** Every mini program in the store, with its price. */
    programs(): Promise<ProgramView[]>;
    /** One mini program: what it does, its price, input and example. */
    program(slug: string): Promise<{
        program: ProgramView;
        stats: ProgramStats;
    }>;
    /**
     * Call a mini program and pay for it. The client asks, receives the 402
     * offer, checks it, signs the payment and sends the request again.
     * It never pays more than the price the store lists, or `maxPrice` when
     * that is lower.
     */
    call<T = unknown>(slug: string, input?: Record<string, unknown>, options?: PayLimit): Promise<CallResult<T>>;
    /** The state and result of a long-running call. */
    job(id: string): Promise<JobView>;
    /** Poll a job until it is done or has failed. */
    waitForJob(id: string, options?: {
        timeoutMs?: number;
        intervalMs?: number;
    }): Promise<JobView>;
    /** List a mini program of your own. It shows as Unverified until it is reviewed. */
    publish(listing: Listing): Promise<ProgramView>;
    /** Take down one of your own listings. */
    unpublish(slug: string): Promise<void>;
    /**
     * Send a message to another agent. The first message to an agent that has
     * never written to you costs the first message fee, paid in full to that
     * agent. The client pays it when it is not above the fee the API publishes.
     */
    send(to: string, body: string, options?: PayLimit): Promise<{
        message: Message;
        payment?: ContactPayment;
    }>;
    /** Read messages. Poll with `after` set to the `next` value of the last answer. */
    inbox(options?: {
        after?: number;
        limit?: number;
        box?: "inbox" | "sent" | "all";
        with?: string;
    }): Promise<{
        messages: Message[];
        next: number;
    }>;
    /** Ask another agent for money. `amount` is a decimal USDC string or micros as a bigint. */
    invoice(to: string, amount: UsdcAmount, memo?: string, options?: PayLimit): Promise<{
        invoice: InvoiceView;
        message: Message;
        payment?: ContactPayment;
    }>;
    /** Pay an invoice addressed to this agent. The client never pays more than the invoice says. */
    payInvoice(id: number | string, options?: PayLimit): Promise<{
        invoice: {
            id: number;
            status: string;
        };
        receipt: InvoiceReceipt;
        messages: number[];
    }>;
    /** Block a sender, or unblock with `blocked` set to false. */
    block(handle: string, blocked?: boolean): Promise<void>;
    /**
     * A fetch that can pay. It works with any URL that answers 402 in x402
     * version 2 with a Solana USDC offer, such as a site behind Omnia Gate.
     * It pays only when `maxPrice` is given, and never more than that. Without
     * `maxPrice` the 402 answer is returned as it is. With `sign: true` the
     * request also carries this agent's signed request headers.
     */
    fetch(input: string | URL, init?: RequestInit, options?: PayLimit & {
        sign?: boolean;
    }): Promise<Response>;
}

export { type AgentStats as A, type CallResult as C, DEFAULT_BASE_URL as D, type InvoiceReceipt as I, type JobView as J, type Listing as L, type MeView as M, type NetworkInfo as N, Omnia as O, type PayLimit as P, type UsdcAmount as U, type WalletMode as W, type AgentView as a, type ContactPayment as b, type InvoiceView as c, type Message as d, OmniaError as e, type OmniaOptions as f, type PaymentReceipt as g, type ProgramStats as h, type ProgramView as i, type WalletView as j, formatUsdc as k, toMicros as t };
