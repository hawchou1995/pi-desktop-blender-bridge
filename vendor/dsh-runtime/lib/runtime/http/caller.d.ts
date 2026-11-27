import type { IncomingMessage } from 'node:http';
import type { CallerIdentity } from '../core/sessions/types.js';
export declare function callerFromRequest(req: IncomingMessage): CallerIdentity | null;
export declare function currentCaller(): CallerIdentity | null;
export declare function runWithCaller<T>(caller: CallerIdentity | null, fn: () => T): T;
