import { Hex } from 'viem';

declare const X402_VERSION = 2;
declare const ELYSIUM_CHAIN_ID = 99901;
/** The network name in offers and receipts, in CAIP-2 form. */
declare const ELYSIUM = "eip155:99901";
declare const USDC_ADDRESS = "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65";
declare const USDC_DECIMALS = 6;
/** The EIP-712 domain of USDC on Elysium, which its `permit` checks. Read from the token and tested against it. */
declare const USDC_PERMIT_DOMAIN: {
    readonly name: "USDC";
    readonly version: "1";
    readonly chainId: 99901;
    readonly verifyingContract: "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65";
};
declare const MAX_LEGS = 8;
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
        /** The contract that settles a payment from an agent's own wallet. The payer's signature names it. */
        splitter: string;
        /** The contract that settles a payment from a guarded wallet. The agent's signature names it. */
        guard: string;
        /** The wallet that submits the payment and pays its gas when the payment is sponsored. */
        relayer: string;
        /** False when the relayer does not sponsor this payment and the payer submits it and pays its own gas. Absent means sponsored. */
        sponsored?: boolean;
        /** Ties the payment to the request it pays for. The payment's number is its hash. */
        memo: string;
        /** Unix seconds: the payment cannot settle from this moment on. */
        validBefore: string;
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
/** The payer's signed approval of the splitter (ERC-2612), sent with the first payment a wallet ever makes. */
interface SignedPermit {
    value: string;
    deadline: string;
    signature: Hex;
}
interface SignedPayment {
    /** Whose USDC moves: the signer's own address, or the guarded wallet (the Safe). */
    payer: string;
    /** The agent key that signed. */
    signer: string;
    /** 65 bytes, 0x hex: the EIP-712 signature over the payment. */
    signature: Hex;
    permit?: SignedPermit;
    /**
     * Set when the payer pays its own gas: the EIP-1559 transaction it signed, which calls the settling contract
     * with this same payment. Raw, 0x hex. The facilitator sends it only after the work has succeeded.
     */
    transaction?: Hex;
}
interface PaymentPayload {
    x402Version: 2;
    resource?: ResourceInfo;
    accepted: PaymentRequirements;
    payload: SignedPayment;
}
interface SettlementResponse {
    success: boolean;
    transaction: string;
    network: string;
    payer: string;
    errorReason?: string;
}
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
/** The EIP-712 type both settling contracts check. */
declare const PAYMENT_TYPES: {
    readonly Payment: readonly [{
        readonly name: "payer";
        readonly type: "address";
    }, {
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "to";
        readonly type: "address[]";
    }, {
        readonly name: "amounts";
        readonly type: "uint256[]";
    }, {
        readonly name: "nonce";
        readonly type: "bytes32";
    }, {
        readonly name: "validBefore";
        readonly type: "uint256";
    }];
};
declare const PERMIT_TYPES: {
    readonly Permit: readonly [{
        readonly name: "owner";
        readonly type: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }, {
        readonly name: "deadline";
        readonly type: "uint256";
    }];
};
declare const SPLITTER_ABI: readonly [{
    readonly type: "function";
    readonly name: "pay";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly name: "p";
        readonly components: readonly [{
            readonly name: "payer";
            readonly type: "address";
        }, {
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "to";
            readonly type: "address[]";
        }, {
            readonly name: "amounts";
            readonly type: "uint256[]";
        }, {
            readonly name: "nonce";
            readonly type: "bytes32";
        }, {
            readonly name: "validBefore";
            readonly type: "uint256";
        }];
    }, {
        readonly name: "signature";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "payWithPermit";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly name: "p";
        readonly components: readonly [{
            readonly name: "payer";
            readonly type: "address";
        }, {
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "to";
            readonly type: "address[]";
        }, {
            readonly name: "amounts";
            readonly type: "uint256[]";
        }, {
            readonly name: "nonce";
            readonly type: "bytes32";
        }, {
            readonly name: "validBefore";
            readonly type: "uint256";
        }];
    }, {
        readonly name: "signature";
        readonly type: "bytes";
    }, {
        readonly name: "permitValue";
        readonly type: "uint256";
    }, {
        readonly name: "permitDeadline";
        readonly type: "uint256";
    }, {
        readonly name: "v";
        readonly type: "uint8";
    }, {
        readonly name: "r";
        readonly type: "bytes32";
    }, {
        readonly name: "s";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "used";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "payer";
        readonly type: "address";
    }, {
        readonly name: "nonce";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly type: "event";
    readonly name: "Paid";
    readonly inputs: readonly [{
        readonly name: "nonce";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: string;
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "token" | "agent";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "to";
        readonly type: "address[]";
        readonly indexed: false;
    }, {
        readonly name: "amounts";
        readonly type: "uint256[]";
        readonly indexed: false;
    }];
}, {
    readonly type: "error";
    readonly name: "Expired";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "BadLegs";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NonceUsed";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "BadSignature";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TransferFailed";
    readonly inputs: readonly [];
}];
declare const GUARD_ABI: readonly [{
    readonly type: "function";
    readonly name: "pay";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly name: "p";
        readonly components: readonly [{
            readonly name: "payer";
            readonly type: "address";
        }, {
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "to";
            readonly type: "address[]";
        }, {
            readonly name: "amounts";
            readonly type: "uint256[]";
        }, {
            readonly name: "nonce";
            readonly type: "bytes32";
        }, {
            readonly name: "validBefore";
            readonly type: "uint256";
        }];
    }, {
        readonly name: "signature";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "configure";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
    }, {
        readonly name: "perPayment";
        readonly type: "uint96";
    }, {
        readonly name: "destinations";
        readonly type: "address[]";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "freeze";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "safe";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "unfreeze";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "used";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "safe";
        readonly type: "address";
    }, {
        readonly name: "nonce";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly type: "function";
    readonly name: "policyOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "safe";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
    }, {
        readonly name: "perPayment";
        readonly type: "uint96";
    }, {
        readonly name: "frozen";
        readonly type: "bool";
    }, {
        readonly name: "restricted";
        readonly type: "bool";
    }];
}, {
    readonly type: "function";
    readonly name: "allowed";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "safe";
        readonly type: "address";
    }, {
        readonly name: "to";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly type: "event";
    readonly name: "Paid";
    readonly inputs: readonly [{
        readonly name: "nonce";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: string;
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "token" | "agent";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "to";
        readonly type: "address[]";
        readonly indexed: false;
    }, {
        readonly name: "amounts";
        readonly type: "uint256[]";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "Configured";
    readonly inputs: readonly [{
        readonly name: "safe";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "agent";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "perPayment";
        readonly type: "uint96";
        readonly indexed: false;
    }, {
        readonly name: "destinations";
        readonly type: "address[]";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "Frozen";
    readonly inputs: readonly [{
        readonly name: "safe";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "by";
        readonly type: "address";
        readonly indexed: true;
    }];
}, {
    readonly type: "event";
    readonly name: "Unfrozen";
    readonly inputs: readonly [{
        readonly name: "safe";
        readonly type: "address";
        readonly indexed: true;
    }];
}, {
    readonly type: "error";
    readonly name: "ZeroAddress";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TooManyDestinations";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotOwner";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotConfigured";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "WalletFrozen";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "Expired";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "BadLegs";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "WrongToken";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NonceUsed";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "OverPaymentCap";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "DestinationNotAllowed";
    readonly inputs: readonly [{
        readonly name: "to";
        readonly type: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "BadSignature";
    readonly inputs: readonly [];
}];
/** The payment as the contracts take it. */
interface PaymentMessage {
    payer: `0x${string}`;
    token: `0x${string}`;
    to: `0x${string}`[];
    amounts: bigint[];
    nonce: Hex;
    validBefore: bigint;
}
/** A payment's number: the hash of the offer's memo. One offer, one payment. */
declare const paymentNonce: (memo: string) => Hex;
declare function paymentDomain(name: "Omnia Splitter" | "Omnia Guard", verifyingContract: string): {
    readonly name: "Omnia Splitter" | "Omnia Guard";
    readonly version: "1";
    readonly chainId: 99901;
    readonly verifyingContract: `0x${string}`;
};
/** The message a payer signs for these requirements. `payer` is the signer's own address, or its guarded wallet. */
declare function paymentMessage(req: PaymentRequirements, payer: string): PaymentMessage;
/** The contract and domain a payment for these requirements is signed for. */
declare function settlerOf(req: PaymentRequirements, guarded: boolean): {
    address: `0x${string}`;
    domain: {
        readonly name: "Omnia Splitter" | "Omnia Guard";
        readonly version: "1";
        readonly chainId: 99901;
        readonly verifyingContract: `0x${string}`;
    };
};
declare function paymentDigest(req: PaymentRequirements, payer: string, guarded: boolean): Hex;
/** Who signed a payment. */
declare function recoverPaymentSigner(req: PaymentRequirements, payer: string, guarded: boolean, signature: Hex): Promise<string>;
/** The call that settles a signed payment: the contract to call and its data. Whoever sends it pays the gas. */
declare function settleCall(req: PaymentRequirements, signed: Pick<SignedPayment, "payer" | "signature" | "permit">, guarded: boolean): {
    to: `0x${string}`;
    data: Hex;
};
interface GuardedSource {
    /** The Safe that is the agent's guarded wallet. */
    safe: string;
}
interface PermitRequest {
    /** The payer's current permit nonce on the token, as the token reports it. */
    nonce: bigint | string | number;
    /** How long the approval signature stays usable, in seconds. Default one hour. */
    ttlSeconds?: number;
}
interface PayOptions {
    /** Pay from a guarded wallet (a Safe) through the guard, instead of from the agent's own address. */
    guarded?: GuardedSource;
    /** Refuse to pay more than this, in base units. A guard against a server that changes its price. */
    maxAmount?: bigint;
    /** Split recipients the payer accepts. When set, any other split recipient is refused. */
    allowedSplitRecipients?: string[];
    /** Sign the one-time approval of the splitter too. Needed for the first payment from a wallet. */
    permit?: PermitRequest;
    /** The clock, for tests. */
    now?: number;
}
/** Sign the payer's ERC-2612 approval of the splitter for any amount. It is sent once, with the wallet's first payment. */
declare function signPermit(seed: Uint8Array, spender: string, request: PermitRequest, now?: number): Promise<SignedPermit>;
/**
 * Sign the payment for one set of requirements.
 * Returns the PaymentPayload to send in the PAYMENT-SIGNATURE header.
 */
declare function createPayment(seed: Uint8Array, req: PaymentRequirements, opts?: PayOptions, resource?: ResourceInfo): Promise<PaymentPayload>;
/** Pick the first offer this client can pay: `exact`, Elysium, USDC. */
declare function selectRequirements(required: PaymentRequired): PaymentRequirements | null;

export { ELYSIUM, ELYSIUM_CHAIN_ID, GUARD_ABI, type GuardedSource, type Leg, MAX_LEGS, PAYMENT_TYPES, PERMIT_TYPES, type PayOptions, type PaymentMessage, type PaymentPayload, type PaymentRequired, type PaymentRequirements, type PermitRequest, type ResourceInfo, SPLITTER_ABI, type SettlementResponse, type SignedPayment, type SignedPermit, type Split, USDC_ADDRESS, USDC_DECIMALS, USDC_PERMIT_DOMAIN, X402_HEADER, X402_VERSION, createPayment, decodeHeader, encodeHeader, legsOf, paymentDigest, paymentDomain, paymentMessage, paymentNonce, recoverPaymentSigner, selectRequirements, settleCall, settlerOf, signPermit };
