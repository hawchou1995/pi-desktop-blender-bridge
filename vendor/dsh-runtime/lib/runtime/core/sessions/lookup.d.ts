import type { CallerIdentity, InstanceRef, SessionRecord } from './types.js';
export declare function pruneSessions(sessions: Map<string, SessionRecord>, listInstances: () => InstanceRef[], now?: number): InstanceRef[];
export declare function findCallerSession(sessions: Map<string, SessionRecord>, c: CallerIdentity): SessionRecord | null;
