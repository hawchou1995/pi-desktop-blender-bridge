import type { CallerIdentity, InstanceRef, SessionRecord, SessionResult } from './types.js';
import type { VirtualGuiLimits } from '../../display/limits.js';
import type { DisplayCapabilities, DisplayProvider } from '../../display/types.js';
export declare const VIRTUAL_GUI_HANDSHAKE_TIMEOUT_MS = 30000;
/** Everything the lifecycle needs from the registry it belongs to. */
export interface VirtualGuiHost {
    display(): DisplayCapabilities;
    findForCaller(c: CallerIdentity): SessionRecord | null;
    getSession(sessionId: string): SessionRecord | null;
    virtualGuiCount(): number;
    limits(): VirtualGuiLimits;
    addSession(session: SessionRecord): void;
    removeSession(sessionId: string): void;
    releaseSession(session: SessionRecord): void;
    waitForInstance(instanceId: string, timeoutMs: number): Promise<boolean>;
}
export type ProviderSelector = (capabilities: DisplayCapabilities) => DisplayProvider | null;
export interface VirtualGuiStartOptions {
    kind?: string;
    consentToken?: string;
}
export declare class VirtualGuiLifecycle {
    private readonly host;
    private readonly selectProvider;
    constructor(host: VirtualGuiHost, selectProvider?: ProviderSelector);
    start(caller: CallerIdentity, opts?: VirtualGuiStartOptions): Promise<SessionResult<{
        session: Record<string, unknown>;
    }>>;
    stop(caller: CallerIdentity, sessionId?: string): Promise<SessionResult<{
        stopped: boolean;
    }>>;
    /** Stop a virtual-gui session whose owner no longer exists (best effort). */
    disposeSession(session: SessionRecord): Promise<void>;
    private dispose;
}
/** Poll the Gateway instance list so a caller can inject a cheaper waiter in tests. */
export declare function waitForAddonInstance(instances: () => InstanceRef[], instanceId: string, timeoutMs: number): Promise<boolean>;
