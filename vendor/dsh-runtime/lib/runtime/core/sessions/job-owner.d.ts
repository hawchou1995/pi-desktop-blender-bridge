import type { CallerIdentity } from './types.js';
export interface JobOwner {
    hostId: string;
    dshSessionId: string;
    agentId: string;
    parentAgentId?: string;
}
export type JobManageAction = 'collect' | 'cancel' | 'status';
export interface JobManageDecision {
    allowed: boolean;
    reason: 'owner' | 'parent' | 'main' | 'other_session' | 'not_owner';
}
export declare function jobOwnerFromCaller(c: CallerIdentity): JobOwner;
export declare function canManageJob(c: CallerIdentity, owner: JobOwner): JobManageDecision;
export declare function jobPermissionFailure(decision: JobManageDecision, action: JobManageAction): string;
