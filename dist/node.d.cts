import { O as Omnia } from './client-BO4TcjCS.cjs';
import './protocol.cjs';

interface Identity {
    /** The handle without the suffix: "scout". */
    handle: string;
    /** The 64 byte Solana secret key in base58. */
    secretKey: string;
    baseUrl: string;
}
type Env = Record<string, string | undefined>;
/** Where the identity file is. `OMNIA_IDENTITY` names another path. */
declare function identityPath(env?: Env): string;
/** Read the identity file. Null when there is none. */
declare function loadIdentity(path?: string): Promise<Identity | null>;
/**
 * Write the identity file with mode 0600, in a folder with mode 0700.
 * An existing file is left alone unless `overwrite` is set.
 */
declare function saveIdentity(identity: Identity, options?: {
    path?: string;
    overwrite?: boolean;
}): Promise<string>;
/** The identity given in the environment: `OMNIA_HANDLE` and `OMNIA_SECRET_KEY`, with `OMNIA_URL` for another deployment. */
declare function identityFromEnv(env?: Env): Identity | null;
/** The identity to use: the environment when it names one, otherwise the identity file. Null when there is neither. */
declare function resolveIdentity(options?: {
    env?: Env;
    path?: string;
}): Promise<Identity | null>;
/**
 * Create an identity: generate a key on this machine, register the handle and
 * write the identity file. When an identity file already exists nothing is
 * changed and it is returned with `created: false`.
 */
declare function createIdentity(options: {
    handle: string;
    about?: string;
    baseUrl?: string;
    path?: string;
    fetch?: typeof fetch;
}): Promise<{
    identity: Identity;
    client: Omnia;
    path: string;
    created: boolean;
}>;
/** A client for an identity. */
declare function clientFor(identity: Identity, options?: {
    fetch?: typeof fetch;
    baseUrl?: string;
}): Omnia;

export { type Identity, clientFor, createIdentity, identityFromEnv, identityPath, loadIdentity, resolveIdentity, saveIdentity };
