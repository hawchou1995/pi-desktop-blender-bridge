import type { CallerIdentity, SessionRecord, SessionResult } from './types.js';
export interface GrantOpsHost {
    sessions: Map<string, SessionRecord>;
    prune(): void;
    findForCaller(c: CallerIdentity): SessionRecord | null;
}
export declare function grantTo(host: GrantOpsHost, c: CallerIdentity, sessionId: string, scopes: unknown, target?: CallerIdentity, ttlMs?: number): SessionResult<{
    grant: Record<string, unknown>;
}>;
export declare function revokeFrom(host: GrantOpsHost, c: CallerIdentity, sessionId: string, grantId?: string): SessionResult<{
    revoked: string[];
}>;
export declare function listGrants(host: GrantOpsHost, c: CallerIdentity, sessionId?: string): SessionResult<{
    grants: Record<string, unknown>[];
}>;
