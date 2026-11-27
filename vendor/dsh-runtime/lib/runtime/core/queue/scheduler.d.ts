import type { JobDecision, JobKind, JobRecord, JobSlot, QueueCapacity } from './types.js';
export declare function isTerminal(job: JobRecord): boolean;
export declare function slotFor(kind: JobKind, params: Record<string, unknown>): JobSlot;
export declare function pendingCount(jobs: JobRecord[]): number;
export declare function slotUse(jobs: JobRecord[], slot: JobSlot): number;
export declare function ownerUse(jobs: JobRecord[], ownerKey: string): number;
export declare function ownerKeyOf(job: JobRecord): string;
export interface Admission {
    job: JobRecord | null;
    decision: JobDecision;
}
/** Return the next job that may start, or a waiting explanation for the head. */
export declare function nextAdmission(jobs: JobRecord[], capacity: QueueCapacity, reservedGpu?: number): Admission;
export declare function waiting(reason: JobDecision['reason'], detail: string): JobDecision;
export declare function explainWaiting(job: JobRecord, jobs: JobRecord[], capacity: QueueCapacity, reservedGpu: number): JobDecision;
