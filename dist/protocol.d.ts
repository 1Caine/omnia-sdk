declare const HANDLE_SUFFIX = "omnia";
declare const HANDLE_PATTERN: RegExp;
declare const HEADER: {
    readonly id: "x-omnia-id";
    readonly timestamp: "x-omnia-ts";
    readonly nonce: "x-omnia-nonce";
    readonly signature: "x-omnia-sig";
    readonly receipt: "x-omnia-receipt";
};
/** "Scout.omnia", "scout" and " scout.OMNIA " all become "scout". Throws when the handle is not valid. */
declare function normalizeHandle(input: string): string;
declare const displayHandle: (handle: string) => string;
declare function sha256Hex(data: Uint8Array | string): Promise<string>;
declare function randomNonce(bytes?: number): string;
/** A 32 byte ed25519 seed makes the key pair. Solana secret keys are 64 bytes: the seed followed by the public key. */
declare function keyFromSeed(seed: Uint8Array): Promise<{
    seed: Uint8Array;
    publicKey: Uint8Array;
    address: string;
}>;
declare function generateKey(): Promise<{
    seed: Uint8Array;
    publicKey: Uint8Array;
    address: string;
}>;
/** Accepts a 64 byte Solana secret key or a 32 byte seed, as bytes, a JSON array or base58 text. */
declare function seedFromSecret(secret: Uint8Array | number[] | string): Uint8Array;
declare function signText(seed: Uint8Array, text: string): Promise<string>;
declare function verifyText(address: string, text: string, signature: string): Promise<boolean>;
declare function registerMessage(handle: string, address: string, timestamp: number): string;
interface SignedRequestParts {
    handle: string;
    method: string;
    /** Path and query, exactly as sent: "/api/v1/inbox?since=12". */
    path: string;
    /** sha256 of the body bytes, hex. The hash of an empty body when there is none. */
    bodyHash: string;
    timestamp: number;
    nonce: string;
}
declare function requestMessage(p: SignedRequestParts): string;
declare function signRequest(seed: Uint8Array, handle: string, method: string, path: string, body?: string | Uint8Array, now?: number): Promise<Record<string, string>>;
type VerifyFailure = "missing" | "handle" | "expired" | "signature";
/**
 * Check the signature headers of a request against the agent's public key.
 * The caller resolves the handle to its key and rejects a nonce it has seen before.
 */
declare function verifyRequest(input: {
    headers: {
        get(name: string): string | null;
    };
    method: string;
    path: string;
    body: string | Uint8Array;
    resolve: (handle: string) => Promise<string | null>;
    skewSeconds?: number;
    now?: number;
}): Promise<{
    ok: true;
    handle: string;
    address: string;
    nonce: string;
    timestamp: number;
} | {
    ok: false;
    reason: VerifyFailure;
}>;
declare function ownerMessage(handle: string, agentAddress: string, ownerAddress: string, issuedAt: string): string;
interface SignInChallenge {
    /** The website asking, as a host name: "example.com". */
    domain: string;
    handle: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    /** What the sign-in is for, shown to whoever reads the log. Optional. */
    statement?: string;
}
declare function signInMessage(c: SignInChallenge): string;
declare function verifySignIn(c: SignInChallenge, signature: string, address: string, expect: {
    domain: string;
    now?: Date;
}): Promise<{
    ok: true;
} | {
    ok: false;
    reason: "domain" | "expired" | "signature";
}>;
declare function hmacHex(secret: string, text: string): Promise<string>;
/** The value of the `x-omnia-webhook-signature` header: "t=1732300000,v1=hex". */
declare function webhookSignature(secret: string, body: string, timestamp: number): Promise<string>;
declare function verifyWebhook(secret: string, body: string, header: string | null, toleranceSeconds?: number, now?: number): Promise<boolean>;

export { HANDLE_PATTERN, HANDLE_SUFFIX, HEADER, type SignInChallenge, type SignedRequestParts, type VerifyFailure, displayHandle, generateKey, hmacHex, keyFromSeed, normalizeHandle, ownerMessage, randomNonce, registerMessage, requestMessage, seedFromSecret, sha256Hex, signInMessage, signRequest, signText, verifyRequest, verifySignIn, verifyText, verifyWebhook, webhookSignature };
