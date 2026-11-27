import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { DisplayCapabilities, DisplayHealth, DisplayInstance, DisplayProvider, DisplayStartRequest } from './types.js';
export type SpawnHelper = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
export interface WinHiddenDesktopProviderOptions {
    env?: NodeJS.ProcessEnv;
    blenderExe?: string;
    workDir?: string;
    /** Explicit helper path (tests); undefined resolves the bundled helper. */
    helperPath?: string | null;
    spawnImpl?: SpawnHelper;
    readyTimeoutMs?: number;
    stopTimeoutMs?: number;
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void;
    onExit?: (handle: DisplayInstance, code: number | null) => void;
}
/** One helper-created hidden desktop; the Windows implementation of DisplayProvider. */
export declare class WinHiddenDesktopProvider implements DisplayProvider {
    readonly kind = "win-hidden-desktop";
    private readonly options;
    private readonly records;
    private counter;
    constructor(options?: WinHiddenDesktopProviderOptions);
    capabilities(): DisplayCapabilities;
    /** Resolve first, so start fails before spawning when the helper is absent. */
    private resolveHelper;
    private commandSpec;
    /** Blender inherits these: the addon dials this Gateway and reuses the expected identity. */
    private spawnEnv;
    private onReadyLine;
    private waitForReady;
    start(request: DisplayStartRequest): Promise<DisplayInstance>;
    private terminate;
    private waitExit;
    private killTree;
    /** Release the helper and therefore Blender (job object kill-on-close). */
    stop(instance: DisplayInstance): Promise<void>;
    health(instance: DisplayInstance): Promise<DisplayHealth>;
    /** Relay tail for diagnostics; null when the handle was never owned here. */
    output(instance: DisplayInstance): {
        stdout: string[];
        stderr: string[];
        exitCode: number | null;
        startedAt: number;
    } | null;
}
