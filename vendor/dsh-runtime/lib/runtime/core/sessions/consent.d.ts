import type { CallerIdentity, SessionResult } from './types.js';
export declare const CONSENT_TTL_MS = 30000;
export declare function issueConsentToken(c: CallerIdentity, now?: number): {
    consentToken: string;
    expiresAt: number;
};
export type ConsentReason = 'missing' | 'invalid' | 'expired' | 'used';
export declare function consumeConsentToken(c: CallerIdentity, token: unknown, now?: number): ConsentReason | 'ok';
export declare function consentFailure<T = Record<string, unknown>>(reason: ConsentReason): SessionResult<T>;
