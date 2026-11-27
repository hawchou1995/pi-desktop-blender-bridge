export declare const VIRTUAL_GUI_DEFAULT_MAX = 4;
export declare const VIRTUAL_GUI_LOW_RESOURCE_MAX = 2;
export declare const VIRTUAL_GUI_MAX_CEILING = 16;
/** Below either threshold the Gateway admits at most the low-resource ceiling. */
export declare const LOW_RESOURCE_TOTAL_MEM_BYTES: number;
export declare const LOW_RESOURCE_FREE_MEM_BYTES: number;
export interface VirtualGuiLimitsInput {
    configured?: number;
    env?: NodeJS.ProcessEnv;
    totalMemBytes?: number;
    freeMemBytes?: number;
}
export interface VirtualGuiLimits {
    limit: number;
    configured: number;
    low_resource: boolean;
    reason: 'configured' | 'low_memory';
    total_mem_bytes: number;
    free_mem_bytes: number;
}
export declare function clampVirtualGuiLimit(value: unknown, fallback: number): number;
/** Resolve the effective limit; an explicit env value wins over the config file. */
export declare function resolveVirtualGuiLimits(input?: VirtualGuiLimitsInput): VirtualGuiLimits;
/** Limits for this machine: configured value plus live memory pressure. */
export declare function systemVirtualGuiLimits(configured?: number, env?: NodeJS.ProcessEnv): VirtualGuiLimits;
