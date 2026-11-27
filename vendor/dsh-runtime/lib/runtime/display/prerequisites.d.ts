import type { DisplayCapabilities, DisplayPrerequisiteSpec } from './types.js';
export declare function prerequisiteTable(platform: string): DisplayPrerequisiteSpec[];
export declare function onPath(command: string, env: NodeJS.ProcessEnv): string | null;
export declare function canReadLinuxGpu(): {
    ok: boolean;
    detail: string;
};
export interface DisplayCapabilityOptions {
    platform?: string;
    configured?: unknown;
    source?: string;
    env?: NodeJS.ProcessEnv;
    providerImplemented?: boolean;
    /** Test seam: override one probe result without touching the machine. */
    checks?: Record<string, boolean>;
    blenderExe?: string;
}
export declare function buildDisplayCapabilities(options?: DisplayCapabilityOptions): DisplayCapabilities;
export interface DisplayCapabilitiesQuery {
    platform?: string;
    env?: NodeJS.ProcessEnv;
}
export declare function displayCapabilities(options?: DisplayCapabilitiesQuery): DisplayCapabilities;
