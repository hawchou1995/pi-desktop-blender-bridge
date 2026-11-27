import type { AvailabilityFailure } from '../availability.js';
import type { ScopeSpec } from './scopes.js';
import type { DisplayInstance, DisplayProvider } from '../../display/types.js';
export declare const OWNER_TTL_MS = 120000;
export declare const OWNER_HEARTBEAT_MS = 30000;
export declare const GRANT_TTL_MS = 30000;
export declare const GRANT_HEARTBEAT_MS = 10000;
export declare const PY_WAIT_MAX_MS = 5000;
export type SessionKind = 'user-gui' | 'virtual-gui';
export type SessionStatus = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
export interface CallerIdentity {
    hostId: string;
    dshSessionId: string;
    agentId: string;
    parentAgentId?: string;
    role?: 'main' | 'subagent';
    callId?: string;
    turnId?: string;
    displayName?: string;
    color?: string;
}
export interface InstanceRef {
    instanceId: string;
    kind?: string;
    ready: boolean;
    project?: string;
}
export interface ViewPose {
    viewpoint: 'viewport' | 'camera' | 'custom';
    from?: [number, number, number];
    lookAt?: [number, number, number];
    lens?: number;
    ortho?: boolean;
    orthoScale?: number;
    camera?: string;
    frame?: number;
    viewMatrix?: number[];
    followUser?: boolean;
    updatedAt: number;
}
export interface AgentPresence {
    caller: CallerIdentity;
    attachedAt: number;
    lastSeen: number;
    view: ViewPose | null;
    selected: string[];
    activity: string;
    color: string;
    displayName: string;
}
/** One object/collection the human changed since the last mark_read. */
export interface HumanEdit {
    kind: 'object' | 'collection';
    name: string;
    revision: number;
    at: number;
}
export interface GrantRecord {
    id: string;
    sessionId: string;
    holder: CallerIdentity;
    grantedBy: CallerIdentity;
    scopes: ScopeSpec[];
    createdAt: number;
    heartbeatAt: number;
    expiresAt: number;
}
export interface Owner {
    hostId: string;
    dshSessionId: string;
    agentId: string;
    claimedAt: number;
    heartbeatAt: number;
}
export interface SessionRecord {
    id: string;
    kind: SessionKind;
    instanceId: string | null;
    status: SessionStatus;
    owner: Owner | null;
    agents: Map<string, AgentPresence>;
    grants: Map<string, GrantRecord>;
    paused: boolean;
    pausedAt: number | null;
    activePy: {
        caller: CallerIdentity;
        startedAt: number;
    } | null;
    humanEdits: Map<string, HumanEdit>;
    humanModifiedAt: number | null;
    /** Set for virtual-gui: the provider handle and the provider that owns it. */
    display: DisplayInstance | null;
    provider: DisplayProvider | null;
    createdAt: number;
    lastActivityAt: number;
}
export type SessionResult<T> = ({
    ok: true;
} & T) | AvailabilityFailure;
export declare const COLORS: string[];
export declare function fail(code: string, stage: 'config' | 'session' | 'queue', rootCause: string, fix: string, evidence?: Record<string, unknown>): AvailabilityFailure;
export declare function callerKey(c: CallerIdentity): string;
export declare function ownerOf(c: CallerIdentity): Owner;
export declare function ownerMatches(owner: Owner | null, c: CallerIdentity): boolean;
export declare function isMain(session: SessionRecord, c: CallerIdentity): boolean;
export declare function colourFor(key: string): string;
export declare function callerView(c: CallerIdentity): Record<string, unknown>;
export declare function grantView(g: GrantRecord): Record<string, unknown>;
export declare function sessionView(s: SessionRecord): Record<string, unknown>;
