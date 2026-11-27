import type { CallerIdentity, GrantRecord, SessionRecord, SessionResult } from './types.js';
import type { ScopeSpec } from './scopes.js';
/** State checks shared by every agent write: ownership, pause, python lock, scope syntax. */
export declare function evaluateWriteGate(session: SessionRecord, c: CallerIdentity, scopes: unknown, opts: {
    py?: boolean;
}): SessionResult<{
    effective: ScopeSpec[];
}>;
/** Main-agent writes are implicit, but must not overlap a live grant held by someone else. */
export declare function authorizeMainWrite(session: SessionRecord, c: CallerIdentity, effective: ScopeSpec[]): SessionResult<{
    mode: 'main';
}>;
export declare function coveringGrant(session: SessionRecord, c: CallerIdentity, effective: ScopeSpec[]): GrantRecord | null;
