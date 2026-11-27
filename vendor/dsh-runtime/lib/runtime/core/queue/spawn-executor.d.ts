import { spawn } from 'node:child_process';
import type { JobExecutor, JobHandle, JobRecord } from './types.js';
export interface SpawnExecutorOptions {
    blenderExe?: string;
    now?: () => number;
    tempRoot?: string;
    spawnImpl?: typeof spawn;
}
/** Exported for contract tests: render and headless use one fixed internal entry. */
export declare function buildJobArgs(job: JobRecord, tempDir: string): {
    args: string[];
    outdir: string | null;
};
export declare class SpawnJobExecutor implements JobExecutor {
    private readonly opts;
    constructor(opts?: SpawnExecutorOptions);
    start(job: JobRecord): JobHandle;
}
