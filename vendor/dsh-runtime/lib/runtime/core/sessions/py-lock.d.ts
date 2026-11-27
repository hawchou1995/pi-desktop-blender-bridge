import type { CallerIdentity, SessionRecord, SessionResult } from './types.js';
export type AuthorizeAttempt = () => SessionResult<{
    sessionId: string;
}>;
export declare function waitForPyLock(attempt: AuthorizeAttempt, waitMs: number): Promise<SessionResult<{
    sessionId: string;
}>>;
export declare function pyTimeoutFailure(session: SessionRecord, c: CallerIdentity): SessionResult<{
    running: boolean;
}>;
