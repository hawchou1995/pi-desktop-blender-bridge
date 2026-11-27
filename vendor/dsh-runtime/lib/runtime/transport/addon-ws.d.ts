import type { Server } from 'node:http';
import type { AddonHandshakeError, AddonInstanceView } from './addon-handshake.js';
export { validateHandshake, gatewayInstances, gatewayHandshakeError } from './addon-handshake.js';
export type { AddonHandshake, AddonHandshakeError, AddonInstanceView, HandshakeResult, } from './addon-handshake.js';
export { ADDON_KINDS, ADDON_PROTOCOL_VERSION, ADDON_VERSION, ADDON_WS_PATH, HEARTBEAT_DEAD_MS, HEARTBEAT_MS, GATEWAY_DEFAULT_PORT, } from './gateway-schema.generated.js';
export declare class GatewayChannelError extends Error {
    stage: string;
    code: string;
    instanceIds?: string[];
    constructor(stage: string, code: string, message: string, instanceIds?: string[]);
}
export interface AddonGatewayOptions {
    gatewayId?: string;
    heartbeatMs?: number;
    deadAfterMs?: number;
    maxMessageBytes?: number;
    onEvent?: (event: Record<string, unknown>) => void;
}
/**
 * Gateway-side addon endpoint. Attach to the single HTTP server with attach();
 * the /addon upgrade path shares that server's port (no second listener).
 */
export declare class AddonGateway {
    readonly gatewayId: string;
    readonly instances: Map<string, AddonInstanceView>;
    /** Most recent rejected handshake, so /doctor can report a version mismatch. */
    lastHandshakeError: AddonHandshakeError | null;
    private readonly sockets;
    private readonly pending;
    private readonly heartbeatMs;
    private readonly deadAfterMs;
    private readonly maxMessageBytes;
    private readonly onEvent?;
    private heartbeat;
    private nextEpoch;
    private closed;
    constructor(opts?: AddonGatewayOptions);
    /** Attach the /addon WebSocket upgrade path to the Gateway HTTP server. */
    attach(server: Server): void;
    list(): AddonInstanceView[];
    /** Wait until the first addon is ready; used by engine.start without spawning anything. */
    ensure(): Promise<void>;
    send(type: string, params?: Record<string, unknown>, timeoutMs?: number, opts?: {
        instanceId?: string;
    }): Promise<unknown>;
    close(): void;
    private resolveInstance;
    private connectionFor;
    private handleUpgrade;
    private onData;
    private onFrame;
    private onMessage;
    private handleHandshake;
    private handleResponse;
    private sendJson;
    private sweepHeartbeat;
    private dropConnection;
    private destroyConnection;
    private failPending;
    private rejectAll;
}
/** AddonClient-compatible facade used by the engine. */
export declare class GatewayAddonClient {
    private readonly gateway;
    readonly protocolInfo: {
        proto: {
            id: string;
            label: string;
            panelHint: string;
        };
        from: string;
    };
    constructor(gateway: AddonGateway);
    ensure(): Promise<void>;
    protocol(): Promise<typeof this.protocolInfo>;
    send(type: string, params?: Record<string, unknown>, timeoutMs?: number, opts?: {
        instanceId?: string;
        noMark?: boolean;
    }): Promise<unknown>;
    close(): void;
    get instances(): AddonInstanceView[];
    get lastHandshakeError(): AddonHandshakeError | null;
}
