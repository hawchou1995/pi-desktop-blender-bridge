import type { CallerIdentity, InstanceRef, SessionRecord, SessionResult } from './types.js';
export declare function claimExisting(session: SessionRecord, c: CallerIdentity): SessionResult<{
    session: SessionRecord;
}>;
export declare function pickInstance(instances: InstanceRef[], opts: {
    instanceId?: string;
}): SessionResult<{
    instance: InstanceRef;
}>;
export declare function createSession(instance: InstanceRef, c: CallerIdentity): SessionRecord;
