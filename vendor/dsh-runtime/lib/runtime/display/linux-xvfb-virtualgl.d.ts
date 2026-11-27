import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { DisplayCapabilities, DisplayHealth, DisplayInstance, DisplayProvider, DisplayStartRequest } from './types.js';
export type SpawnDisplayChild = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
export interface LinuxXvfbVirtualGlProviderOptions {
    env?: NodeJS.ProcessEnv;
    /** Test seam; production uses process.platform. */
    platform?: string;
    blenderExe?: string;
    xvfbPath?: string;
    /** Explicit vglrun path; null disables the hardware transport. */
    vglrunPath?: string | null;
    spawnImpl?: SpawnDisplayChild;
    /** Test seam for the X socket / prerequisite probes. */
    fileExists?: (file: string) => boolean;
    displayReady?: (display: string, xvfb: ChildProcess) => Promise<boolean>;
    gpuReadable?: () => boolean;
    signalGroup?: (child: ChildProcess, signal: NodeJS.Signals) => void;
    checks?: Record<string, boolean>;
    /** Test seam for the feature gate; production reads CFG. */
    feature?: string;
    featureSource?: string;
    displayBase?: number;
    width?: number;
    height?: number;
    workDir?: string;
    readyTimeoutMs?: number;
    readyGraceMs?: number;
    stopTimeoutMs?: number;
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void;
    onExit?: (handle: DisplayInstance, code: number | null) => void;
}
/** One Xvfb + Blender GUI pair; the Linux L1 implementation of DisplayProvider. */
export declare class LinuxXvfbVirtualGlProvider implements DisplayProvider {
    readonly kind = "linux-xvfb-virtualgl";
    private readonly options;
    private readonly records;
    private readonly usedDisplays;
    private counter;
    constructor(options?: LinuxXvfbVirtualGlProviderOptions);
    private env;
    private exists;
    capabilities(): DisplayCapabilities;
    /** Resolve commands and the GL transport before spawning anything. */
    private commandSpec;
    private assertPlatform;
    private assertFeatureEnabled;
    private resolvePrograms;
    private buildSpawnEnv;
    private buildSpawnOptions;
    private pickDisplay;
    private displayReady;
    private grace;
    start(request: DisplayStartRequest): Promise<DisplayInstance>;
    private cleanupDisplay;
    stop(instance: DisplayInstance): Promise<void>;
    health(instance: DisplayInstance): Promise<DisplayHealth>;
    /** Relay tail plus the chosen GL transport for diagnostics; null when unowned. */
    output(instance: DisplayInstance): {
        stdout: string[];
        stderr: string[];
        exitCode: number | null;
        startedAt: number;
        hardware_gl: boolean;
        gl_transport: string;
    } | null;
}
