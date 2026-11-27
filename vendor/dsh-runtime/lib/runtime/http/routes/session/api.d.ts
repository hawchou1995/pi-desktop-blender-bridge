import type { ServerResponse } from 'node:http';
import type { SessionRegistry } from '../../../core/sessions/registry.js';
export interface SessionApiResult {
    status: number;
    body: Record<string, unknown>;
}
export declare function dispatchSessionAction(registry: SessionRegistry, action: string, payload: Record<string, unknown>): Promise<SessionApiResult>;
export declare function sessionAction(res: ServerResponse, registry: SessionRegistry, payload: Record<string, unknown>): Promise<SessionApiResult>;
