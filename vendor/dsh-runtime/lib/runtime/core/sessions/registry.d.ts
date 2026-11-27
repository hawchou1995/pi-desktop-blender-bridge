import type { VirtualGuiLimits } from '../../display/limits.js';
import type { HumanEditInput } from './human-edits.js';
import type { DisplayCapabilities } from '../../display/types.js';
import type { ProviderSelector } from './virtual-gui.js';
import type { CallerIdentity, InstanceRef, SessionKind, SessionRecord, SessionResult, ViewPose } from './types.js';
export interface SessionRegistryOptions {
    display?: () => DisplayCapabilities;
    selectProvider?: ProviderSelector;
    waitForInstance?: (instanceId: string, timeoutMs: number) => Promise<boolean>;
    limits?: () => VirtualGuiLimits;
}
export declare class SessionRegistry {
    private sessions;
    private instances;
    private humanPaused;
    constructor(instances: () => InstanceRef[], options?: (() => DisplayCapabilities) | SessionRegistryOptions);
    private listInstances;
    private readonly displayFn;
    private readonly limitsFn;
    private readonly waitForInstanceFn;
    private readonly lifecycle;
    display(): DisplayCapabilities;
    refreshInstances(next: InstanceRef[]): void;
    private prune;
    findForCaller(c: CallerIdentity): SessionRecord | null;
    private ensureAttached;
    private adopt;
    list(): Record<string, unknown>[];
    listFor(c: CallerIdentity): Record<string, unknown>[];
    status(c: CallerIdentity, sessionId?: string): SessionResult<{
        session: Record<string, unknown>;
    }>;
    attach(c: CallerIdentity, opts?: {
        instanceId?: string;
        kind?: SessionKind;
    }): SessionResult<{
        session: Record<string, unknown>;
    }>;
    claim(c: CallerIdentity, opts?: {
        instanceId?: string;
    }): SessionResult<{
        session: Record<string, unknown>;
    }>;
    detach(c: CallerIdentity, sessionId?: string): SessionResult<{
        released: boolean;
    }>;
    release(c: CallerIdentity, sessionId?: string): SessionResult<{
        released: boolean;
    }>;
    releaseSession(s: SessionRecord): void;
    getSession(sessionId: string): SessionRecord | null;
    virtualGuiCount(): number;
    addSession(session: SessionRecord): void;
    removeSession(sessionId: string): void;
    /** The addon socket dropped: a virtual-gui session for it cannot outlive it. */
    handleInstanceGone(instanceId: string): void;
    limits(): VirtualGuiLimits;
    waitForInstance(instanceId: string, timeoutMs: number): Promise<boolean>;
    heartbeat(c: CallerIdentity, sessionId?: string): SessionResult<{
        session: Record<string, unknown>;
    }>;
    doctor(c: CallerIdentity, sessionId?: string): SessionResult<{
        readiness: Record<string, unknown>;
        session: Record<string, unknown> | null;
    }>;
    start(c: CallerIdentity, opts?: {
        kind?: SessionKind;
        consentToken?: string;
    }): Promise<SessionResult<{
        session: Record<string, unknown>;
    }>>;
    issueConsent(c: CallerIdentity): SessionResult<{
        consentToken: string;
        expiresAt: number;
    }>;
    stop(c: CallerIdentity, sessionId?: string): Promise<SessionResult<{
        stopped: boolean;
    }>>;
    grant(c: CallerIdentity, sessionId: string, scopes: unknown, target?: CallerIdentity, ttlMs?: number): SessionResult<{
        grant: Record<string, unknown>;
    }>;
    revoke(c: CallerIdentity, sessionId: string, grantId?: string): SessionResult<{
        revoked: string[];
    }>;
    grants(c: CallerIdentity, sessionId?: string): SessionResult<{
        grants: Record<string, unknown>[];
    }>;
    private grantHost;
    pause(c: CallerIdentity, _sessionId?: string): SessionResult<{
        paused: boolean;
    }>;
    resume(c: CallerIdentity, _sessionId?: string): SessionResult<{
        paused: boolean;
    }>;
    private mustOwn;
    presence(c: CallerIdentity, sessionId?: string): SessionResult<{
        presence: Record<string, unknown>[];
    }>;
    updateView(c: CallerIdentity, sessionId: string, view: Omit<ViewPose, 'updatedAt'>): SessionResult<{
        presence: Record<string, unknown>[];
    }>;
    updateSelection(c: CallerIdentity, sessionId: string, selected: string[], activity?: string): SessionResult<{
        presence: Record<string, unknown>[];
    }>;
    private writableSession;
    /** Authorize one write call. Returns the owning session or a structured failure. */
    authorizeWrite(c: CallerIdentity, sessionId: string | undefined, scopes: unknown, opts?: {
        py?: boolean;
        waitMs?: number;
    }): SessionResult<{
        sessionId: string;
        mode: 'main' | 'grant';
        grantId?: string;
    }>;
    beginPy(c: CallerIdentity, sessionId?: string, waitMs?: number): Promise<SessionResult<{
        sessionId: string;
    }>>;
    /** Report a timed-out Python call without releasing the lock. */
    timeoutPy(c: CallerIdentity, sessionId?: string): SessionResult<{
        running: boolean;
    }>;
    applyHumanEdits(instanceId: string | undefined, edits: HumanEditInput[]): number;
    markRead(c: CallerIdentity, sessionId: string | undefined, scopes: unknown): SessionResult<{
        cleared: number;
    }>;
    applyHumanPause(instanceId: string | undefined, paused: boolean): number;
    endPy(c: CallerIdentity, sessionId?: string): SessionResult<{
        released: boolean;
    }>;
}
