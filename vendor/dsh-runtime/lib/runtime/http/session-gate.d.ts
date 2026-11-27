import { availabilityFailure } from '../core/availability.js';
import type { AvailabilityFailure } from '../core/availability.js';
import type { SessionRegistry } from '../core/sessions/registry.js';
export declare function setSessionRegistry(registry: SessionRegistry): void;
export declare function sessionRegistry(): SessionRegistry | null;
/** Resolve the write scope declared by a route payload. */
export declare function writeScopesFor(payload: Record<string, unknown>, fallback: unknown): unknown;
export declare function sessionWriteGate(payload: Record<string, unknown> | null | undefined, fallbackScope?: unknown): AvailabilityFailure | null;
export declare function gateResponse(failure: AvailabilityFailure): Record<string, unknown>;
export { availabilityFailure };
