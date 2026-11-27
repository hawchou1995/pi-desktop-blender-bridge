export declare class DisplayProviderError extends Error {
    readonly stage: string;
    readonly code: string;
    readonly fix: string;
    readonly evidence: Record<string, unknown>;
    constructor(stage: string, code: string, message: string, fix: string, evidence?: Record<string, unknown>);
    /** The availability-envelope-shaped view used by callers and tests. */
    view(): Record<string, unknown>;
}
