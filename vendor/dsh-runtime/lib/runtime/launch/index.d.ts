import type { LaunchOpts } from './resolve.js';
export type { LaunchOpts } from './resolve.js';
export { ADDON_NAME_HINTS, LAUNCH_BOOT_PY, addonNameHit } from './resolve.js';
/** 3.1 launch deps: readiness is a Gateway instance count, never an addon TCP port. */
export interface LaunchDeps {
    instanceCount?: () => number;
}
export declare function launchBlender(opts?: LaunchOpts, deps?: LaunchDeps): Promise<Record<string, unknown>>;
