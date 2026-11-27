import type { JobRecord, JobStore } from './types.js';
export declare function defaultQueueFile(): string;
export declare class JsonJobStore implements JobStore {
    private readonly file;
    constructor(file?: string);
    load(): JobRecord[];
    save(jobs: JobRecord[]): void;
}
/** In-memory store used by unit tests and by a queue that should not persist. */
export declare class MemoryJobStore implements JobStore {
    jobs: JobRecord[];
    saves: number;
    load(): JobRecord[];
    save(jobs: JobRecord[]): void;
}
