import type { GatewayApp } from './app.js';
import type { GatewayOwner } from './owner.js';
export interface GatewayLifecycleOptions {
    /** Bind process signal handlers; tests/assets can run without owning process exit. */
    handleSignals?: boolean;
}
export interface GatewayStartResult {
    ok: boolean;
    port: number;
    owner?: GatewayOwner;
    error?: Record<string, unknown>;
}
/** Remove this Gateway's diagnostic owner file and close its server. */
export declare function stopGateway(app: GatewayApp): void;
/** Listen on the configured loopback port. Never steals or shares an occupied port. */
export declare function startGateway(app: GatewayApp, opts?: GatewayLifecycleOptions): Promise<GatewayStartResult>;
