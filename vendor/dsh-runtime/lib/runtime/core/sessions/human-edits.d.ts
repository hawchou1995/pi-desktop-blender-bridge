import type { ScopeSpec } from './scopes.js';
import type { CallerIdentity, HumanEdit, SessionRecord, SessionResult } from './types.js';
export interface HumanEditInput {
    kind?: unknown;
    name?: unknown;
    revision?: unknown;
}
/** Apply one add-on event to every session bound to that instance. */
export declare function applyHumanEditsToSessions(sessions: Map<string, SessionRecord>, instanceId: unknown, edits: HumanEditInput[]): number;
/** Clear human-edit records the caller has re-read. */
export declare function markHumanRead(sessions: Map<string, SessionRecord>, c: CallerIdentity, sessionId: string | undefined, scopes: unknown): SessionResult<{
    cleared: number;
}>;
/** Merge edits from one add-on instance; newest revision wins. */
export declare function recordHumanEdits(session: SessionRecord, edits: HumanEditInput[], now?: number): number;
/** Edits the requested write scopes would overwrite; empty means no conflict. */
export declare function conflictingHumanEdits(session: SessionRecord, scopes: ScopeSpec[]): HumanEdit[];
/** Clear the edits covered by the scopes the caller just re-read. */
export declare function clearHumanEdits(session: SessionRecord, scopes: ScopeSpec[]): number;
