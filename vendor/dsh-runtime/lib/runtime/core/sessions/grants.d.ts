import type { CallerIdentity, SessionRecord, SessionResult } from './types.js';
import type { ScopeSpec } from './scopes.js';
/** Validate one grant request against the owning session and live grants. */
export declare function resolveGrantContext(session: SessionRecord, c: CallerIdentity, scopes: unknown, target?: CallerIdentity): SessionResult<{
    parsed: ScopeSpec[];
    holder: CallerIdentity;
}>;
