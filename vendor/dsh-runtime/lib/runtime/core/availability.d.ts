/**
 * Gateway-side mirrors of the shared availability contract.
 *
 * The Gateway runs in a separate process from the DSH host, so it carries its
 * own copy of the constructor and validator while both sides generate their
 * enum/budget constants from config/availability.json.
 */
import { AVAILABILITY_BUDGETS_MS, AVAILABILITY_FALLBACK_KINDS, AVAILABILITY_REQUIRED_FIELDS, AVAILABILITY_STAGES } from './availability-schema.generated.js';
import type { AvailabilityFallbackKind, AvailabilityStage } from './availability-schema.generated.js';
export { AVAILABILITY_BUDGETS_MS, AVAILABILITY_FALLBACK_KINDS, AVAILABILITY_REQUIRED_FIELDS, AVAILABILITY_STAGES, };
export type { AvailabilityFallbackKind, AvailabilityStage };
export interface AvailabilityFallback {
    kind: AvailabilityFallbackKind;
    summary: string;
}
export interface AvailabilityFailure {
    ok: false;
    code: string;
    stage: AvailabilityStage;
    root_cause: string;
    fix: string;
    fallback: AvailabilityFallback;
    evidence: Record<string, unknown>;
}
export interface AvailabilityInput {
    stage: AvailabilityStage;
    code?: string;
    rootCause: string;
    fix: string;
    fallback: AvailabilityFallback | string;
    evidence?: Record<string, unknown>;
}
export declare function availabilityFailure(input: AvailabilityInput): AvailabilityFailure;
export declare function validateAvailabilityEnvelope(value: unknown): string[];
export declare function availabilityBudgetMs(stage: AvailabilityStage): number;
/** Map a legacy failure code to exactly one stage; never returns a generic unknown. */
export declare function stageForFailureCode(code: unknown): AvailabilityStage;
/**
 * Normalize a legacy failure response at the HTTP edge.
 *
 * Routes still carry historical fields (error, code, diagnosis); adding the four
 * question envelope here proves every failed response crosses the contract even
 * before each route is rewritten. An explicit stage always wins; a diagnosis
 * stage is preferred over the code heuristic.
 */
export declare function normalizeAvailability(value: unknown): unknown;
