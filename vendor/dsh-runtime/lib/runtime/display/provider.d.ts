import type { DisplayCapabilities, DisplayProvider } from './types.js';
export interface ProviderCandidate {
    kind: string;
    preview: boolean;
    implemented: boolean;
}
export interface ProviderSelection {
    provider: DisplayProvider | null;
    candidates: ProviderCandidate[];
    capabilities: DisplayCapabilities;
    reason: string | null;
}
export interface SelectProviderOptions {
    platform?: NodeJS.Platform | string;
    env?: NodeJS.ProcessEnv;
    /** Explicit helper path for tests; forwarded to the Windows provider. */
    helperPath?: string | null;
    /** Capabilities to select against; defaults to the live machine capabilities. */
    capabilities?: DisplayCapabilities;
}
/** Ordered fallback list; the first implemented candidate wins. */
export declare function providerCandidates(platform?: NodeJS.Platform | string): ProviderCandidate[];
export declare function selectDisplayProvider(options?: SelectProviderOptions): ProviderSelection;
