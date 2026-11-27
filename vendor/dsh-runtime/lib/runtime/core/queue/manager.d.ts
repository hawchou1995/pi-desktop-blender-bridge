import type { AvailabilityFailure } from '../availability.js';
import type { CallerIdentity } from '../sessions/types.js';
import type { JobExecutor, JobRecord, JobStore, QueueCapacity, SubmitInput } from './types.js';
export interface QueueOptions {
    executor: JobExecutor;
    store?: JobStore;
    capacity?: Partial<QueueCapacity>;
    reservedGpu?: () => number;
    now?: () => number;
    id?: () => string;
}
export declare class QueueError extends Error {
    readonly failure: AvailabilityFailure;
    constructor(failure: AvailabilityFailure);
}
export declare function failureForRestart(): AvailabilityFailure;
export declare class JobQueue {
    private readonly store;
    private readonly executor;
    private readonly capacity;
    private readonly reservedGpu;
    private readonly now;
    private readonly newId;
    private readonly jobs;
    private readonly handles;
    constructor(opts: QueueOptions);
    private restore;
    submit(caller: CallerIdentity, input: SubmitInput): JobRecord;
    status(id: string): JobRecord | null;
    wait(_caller: CallerIdentity, id: string, timeoutMs?: number): Promise<Record<string, unknown>>;
    collect(caller: CallerIdentity, id: string, tail?: number): Record<string, unknown>;
    cancel(caller: CallerIdentity, id: string): Record<string, unknown>;
    list(filter?: {
        state?: string;
        kind?: string;
        owner?: string;
    }): JobRecord[];
    perf(): Record<string, unknown>;
    private oldestQueuedAt;
    private pump;
    private recordWaiting;
    private start;
    private finish;
    private fail;
    private transition;
    private events;
    private authorize;
    private find;
    private snapshot;
    private persist;
}
