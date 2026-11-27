import type { AddonKind } from './gateway-schema.generated.js';
export interface AddonHandshake {
    instanceId: string;
    kind: AddonKind;
    version: string;
    protocol: number;
    project: string;
    capabilities: string[];
}
export type HandshakeResult = {
    ok: true;
    handshake: AddonHandshake;
} | {
    ok: false;
    stage: 'handshake';
    code: 'missing_field' | 'unsupported_protocol' | 'unknown_kind' | 'invalid_field';
    message: string;
    fix: string;
    upgrade_required?: boolean;
};
/** Validate and normalise one addon handshake; never throws on hostile input. */
export declare function validateHandshake(value: unknown): HandshakeResult;
/** The most recent rejected handshake, kept so /doctor can attribute a version mismatch. */
export interface AddonHandshakeError {
    stage: 'handshake';
    code: string;
    message: string;
    fix: string;
    upgrade_required?: boolean;
    at: number;
}
export interface AddonInstanceView {
    instanceId: string;
    kind: AddonKind;
    version: string;
    protocol: number;
    project: string;
    capabilities: string[];
    ready: boolean;
    connectedAt: number;
    lastSeen: number;
    epoch: number;
}
/** Return the instance registry when `addon` is a Gateway client (3.1), null for the legacy TCP client. */
export declare function gatewayInstances(addon: unknown): AddonInstanceView[] | null;
/** Return the last rejected handshake on a Gateway client, null for the legacy client. */
export declare function gatewayHandshakeError(addon: unknown): AddonHandshakeError | null;
