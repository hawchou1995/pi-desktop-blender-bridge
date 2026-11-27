import type { IncomingHttpHeaders } from 'node:http';
import type { CallerIdentity } from '../sessions/types.js';
import { JobQueue } from './manager.js';
export interface QueuePayload extends Record<string, unknown> {
    op?: string;
    id?: string;
    timeout_ms?: number;
    tail?: number;
    kind?: string;
    priority?: number;
    state?: string;
    owner?: string;
}
export declare function callerFromHeaders(headers: IncomingHttpHeaders): CallerIdentity;
export declare class JobSurface {
    private readonly queue;
    constructor(queue: JobQueue);
    handle(caller: CallerIdentity, payload: QueuePayload): Promise<Record<string, unknown>>;
}
