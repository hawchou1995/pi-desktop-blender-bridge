import type { CallerIdentity, SessionRecord, SessionResult } from './types.js';
import type { DisplayCapabilities } from '../../display/types.js';
export interface VirtualGuiStartInput {
    caller: CallerIdentity;
    kind?: string;
    consentToken?: string;
    capability: DisplayCapabilities;
    existing: SessionRecord | null;
}
export declare function startVirtualGuiGate(input: VirtualGuiStartInput): SessionResult<{
    capability: DisplayCapabilities;
}>;
