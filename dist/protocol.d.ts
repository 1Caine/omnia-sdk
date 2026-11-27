import { Hex } from 'viem';

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
/** True for a 20 byte 0x address. A mixed-case address must carry a correct checksum. */
declare function isAddress(value: unknown): value is string;
/** The one spelling of an address used everywhere: 0x and the EIP-55 checksum. Throws when it is not an address. */
declare function normalizeAddress(value: string): string;
/** Two addresses are the same wallet whatever their letter case. */
declare const sameAddress: (a: string | null | undefined, b: string | null | undefined) => boolean;
declare function sha256Hex(data: Uint8Array | string): Promise<string>;
declare function randomNonce(bytes?: number): string;
/** A 32 byte secp256k1 private key makes the key pair and its 0x address. */
declare function keyFromSeed(seed: Uint8Array): Promise<{
    seed: Uint8Array;
    address: string;
}>;
declare function generateKey(): Promise<{
    seed: Uint8Array;
    address: string;
}>;
/** Accepts a 32 byte private key as bytes, a JSON array of numbers, or hex text with or without 0x. */
declare function seedFromSecret(secret: Uint8Array | number[] | string): Uint8Array;
/** The private key as wallets import it: 0x and 64 hex characters. */
declare const secretToHex: (seed: Uint8Array) => Hex;
/** Sign a text the way a wallet signs a message (EIP-191). The signature is 65 bytes, as 0x hex. */
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
 * Check the signature headers of a request against the agent's address.
 * The caller resolves the handle to its address and rejects a nonce it has seen before.
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

export { HANDLE_PATTERN, HANDLE_SUFFIX, HEADER, type SignInChallenge, type SignedRequestParts, type VerifyFailure, displayHandle, generateKey, hmacHex, isAddress, keyFromSeed, normalizeAddress, normalizeHandle, ownerMessage, randomNonce, registerMessage, requestMessage, sameAddress, secretToHex, seedFromSecret, sha256Hex, signInMessage, signRequest, signText, verifyRequest, verifySignIn, verifyText, verifyWebhook, webhookSignature };
