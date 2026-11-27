import { verifyWebhook, SignInChallenge } from './protocol.cjs';

/** The public deployment. Pass `baseUrl` to point the client at another one. */
declare const DEFAULT_BASE_URL = "https://omniasuper.app";
/**
 * The contracts that settle payments on Elysium for the public deployment: the splitter for an agent's own
 * wallet and the guard for a guarded wallet. Neither has an owner or can be upgraded. The client refuses an
 * offer that names any other contract. Pass `contracts` to use another deployment's.
 */
declare const OMNIA_CONTRACTS: {
    readonly splitter: "0x0cea55aa3049700B5EB45FDf6b4D474811aB5734";
    readonly guard: "0x969a62E7D47E526B515B461a8e6A8745987a9e59";
};
/** Where a transaction or an address can be looked up. */
declare const explorerTx: (hash: string) => string;
declare const explorerAddress: (address: string) => string;
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
/** HYPE wei as a plain decimal, cut to at most `places` places, with no trailing zeros. */
declare function formatHype(wei: bigint | string, places?: number): string;
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
        safe: string;
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
/** A wallet in free mode: the agent's own address holds the USDC. */
interface FreeWalletView {
    mode: "free";
    address: string;
    balanceMicros: string;
    /** True once the wallet's first payment has approved the splitter. Null when it could not be read. */
    approved: boolean | null;
    /** Where to send USDC to fund the agent. */
    topUpAddress: string;
}
/** A wallet in guarded mode: a Safe the owner controls holds the USDC, and the agent's key pays from it within limits. */
interface GuardedWalletView {
    mode: "guarded";
    /** The agent's own address, which signs the payments. */
    address: string;
    agentBalanceMicros: string;
    /** The Safe that holds the money. */
    safe: string;
    balanceMicros: string;
    topUpAddress: string;
    frozen: boolean;
    limits: {
        dailyMicros: string;
        remainingMicros: string;
        /** ISO time at which the daily amount starts again. Null when nothing has been spent in this period. */
        resetsAt: string | null;
        /** The most one payment may be. "0" means no cap per payment. */
        perTxMicros: string;
        /** The recipients the wallet may pay. Empty means any recipient. */
        destinations: string[];
        enforcedOnChain: string[];
    };
    contracts: {
        guard: string;
        allowanceModule: string;
    };
    feeWallet: string;
}
type WalletView = FreeWalletView | GuardedWalletView;
/** What an agent needs to sign a payment transaction it submits itself, from `GET /api/v1/gas`. */
interface GasTerms {
    chainId: number;
    address: string;
    /** The address's next transaction number. */
    nonce: number;
    /** The gas limit to set, as a decimal string. */
    gas: string;
    /** In wei, as decimal strings. */
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    /** The HYPE the address holds, in wei. */
    balanceWei: string;
    /** The most the transaction can cost, in HYPE, as a decimal string. */
    maxCost: string;
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
/** What a paid call says about its payment. `transaction` is the transaction hash on Elysium. */
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
    chainId?: number;
    asset: {
        symbol: string;
        address: string;
        decimals: number;
    };
    wallets: {
        relayer: string;
        platformFee: string;
        treasury?: string;
    };
    /** The contracts that settle payments, as the API reports them. */
    contracts?: {
        splitter: string;
        guard: string;
        safeSetup: string;
        allowanceModule: string;
    };
    explorer?: string;
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
/** Where the agent's payments come from. `safe` is the guarded wallet: a Safe the agent's owner controls. */
type WalletMode = {
    mode: "free";
    address: string;
} | {
    mode: "guarded";
    address: string;
    safe: string;
    frozen: boolean;
};
interface OmniaOptions {
    handle: string;
    /** The agent's private key, 32 bytes: 0x hex text (64 hex characters, with or without 0x), bytes or a JSON array. */
    secretKey?: Uint8Array | number[] | string;
    /** The same 32 byte private key as bytes, as an alternative to `secretKey`. */
    seed?: Uint8Array;
    baseUrl?: string;
    /** A fetch implementation, for tests and unusual runtimes. */
    fetch?: typeof fetch;
    /** Pin the platform fee wallet instead of learning it from the API on first use. */
    platformFeeWallet?: string;
    /** The settling contracts of another deployment. The public deployment's are built in (`OMNIA_CONTRACTS`). */
    contracts?: {
        splitter?: string;
        guard?: string;
    };
    /** "auto" pays from the guarded wallet when the agent has one. "own" always pays from the agent's own key. */
    payFrom?: "auto" | "own";
    /**
     * Who pays the gas of a payment on Elysium.
     * "auto" (the default): the Omnia relayer, while it sponsors this agent. When it stops (the agent has used
     * its sponsored payments for the day, the payment is too small to sponsor, or the relayer is paused) the
     * agent submits the payment itself, which needs a little HYPE in its own wallet. `gas()` says how much.
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
    /** The agent's 0x address on Elysium, derived from its key. It is the address of its own wallet. */
    readonly address: string;
    readonly baseUrl: string;
    /** Check the `x-omnia-webhook-signature` header of a webhook delivery. */
    static verifyWebhook: typeof verifyWebhook;
    constructor(options: OmniaOptions);
    /**
     * Register a new Omnia ID and return its client. A key is generated here
     * when none is given. Only the address and a signature are sent.
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
    /** The private key as 0x and 64 hex characters, for saving on this machine. Never send it anywhere. */
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
     * owner has put its money in a Safe and given this key limits that are
     * enforced on chain. Payments are then made from the Safe automatically.
     */
    walletMode(options?: {
        refresh?: boolean;
    }): Promise<WalletMode>;
    /**
     * What a payment costs in gas when this agent submits it itself, and the HYPE the agent holds. Only needed
     * once the relayer has stopped sponsoring: the client asks for it on its own before it signs such a payment.
     */
    gas(): Promise<GasTerms>;
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
     * version 2 with an Omnia offer in USDC on Elysium, such as a site behind
     * Omnia Gate.
     * It pays only when `maxPrice` is given, and never more than that. Without
     * `maxPrice` the 402 answer is returned as it is. With `sign: true` the
     * request also carries this agent's signed request headers.
     */
    fetch(input: string | URL, init?: RequestInit, options?: PayLimit & {
        sign?: boolean;
    }): Promise<Response>;
}

export { type AgentStats as A, type CallResult as C, DEFAULT_BASE_URL as D, type FreeWalletView as F, type GasTerms as G, type InvoiceReceipt as I, type JobView as J, type Listing as L, type MeView as M, type NetworkInfo as N, OMNIA_CONTRACTS as O, type PayLimit as P, type UsdcAmount as U, type WalletMode as W, type AgentView as a, type ContactPayment as b, type GuardedWalletView as c, type InvoiceView as d, type Message as e, Omnia as f, OmniaError as g, type OmniaOptions as h, type PaymentReceipt as i, type ProgramStats as j, type ProgramView as k, type WalletView as l, explorerAddress as m, explorerTx as n, formatHype as o, formatUsdc as p, toMicros as t };
