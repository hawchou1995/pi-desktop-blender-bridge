import type { VirtualGuiFeature } from './types.js';
/** Flipped by the V0 acceptance task (5.5); tests pin both sides. */
export declare const VIRTUAL_GUI_V0_RELEASED = true;
export interface FeatureResolution {
    value: VirtualGuiFeature;
    source: string;
}
export declare function parseVirtualGuiFeature(value: unknown): VirtualGuiFeature | null;
/**
 * Resolve the effective feature value.
 * - Windows: default off before V0, auto after V0.
 * - Linux/macOS: default off; only an explicit "on" enables the preview path.
 * - An unparseable value fails closed to off and reports its source.
 */
export declare function resolveVirtualGuiFeature(input: {
    configured?: unknown;
    source?: string;
    platform?: string;
    v0Released?: boolean;
}): FeatureResolution;
