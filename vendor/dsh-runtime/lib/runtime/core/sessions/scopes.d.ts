export type ScopeKind = 'exclusive' | 'collection' | 'prefix' | 'object';
export interface ScopeSpec {
    kind: ScopeKind;
    value?: string;
}
/** Parse one scope token ("exclusive", "collection:COL_Lights", "prefix:LGT-", "object:<uid>"). */
export declare function parseScope(value: unknown): ScopeSpec | null;
export declare function parseScopes(value: unknown): ScopeSpec[];
/** True when two scope declarations may touch the same scene state. */
export declare function scopesOverlap(left: ScopeSpec, right: ScopeSpec): boolean;
export declare function anyOverlap(left: ScopeSpec[], right: ScopeSpec[]): boolean;
/** True when a grant scope covers a write scope (an exclusive grant covers everything). */
export declare function scopeCovers(grant: ScopeSpec, write: ScopeSpec): boolean;
export declare function scopesCover(granted: ScopeSpec[], writes: ScopeSpec[]): boolean;
