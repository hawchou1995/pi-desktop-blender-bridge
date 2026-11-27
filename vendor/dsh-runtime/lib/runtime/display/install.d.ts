import { spawn } from 'node:child_process';
import type { DisplayCapabilities } from './types.js';
export interface InstallStep {
    description: string;
    command: string;
}
export interface InstallPlan {
    id: string;
    label: string;
    /** Current detection result: true means this prerequisite is already present. */
    ok: boolean;
    needsRoot: boolean;
    /** True only when oneClick is a complete, testable install command. */
    supported: boolean;
    /** argv passed to spawn; null when the user must run command manually. */
    oneClick: string[] | null;
    /** Displayed command; the elevated argv is this command split on spaces. */
    command: string | null;
    steps: InstallStep[];
    reason?: string;
}
export interface Distro {
    id: string;
    version: string;
}
export interface InstallPlanInput {
    platform?: string;
    env?: NodeJS.ProcessEnv;
    distro?: Distro;
    readFile?: (file: string) => string;
    hasPkexec?: boolean;
}
export interface InstallRunResult {
    ok: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
    error?: string;
}
export declare function detectDistro(input?: InstallPlanInput): Distro;
/** Build one plan per prerequisite row; callers filter plan.ok === false. */
export declare function buildInstallPlans(capabilities: DisplayCapabilities, input?: InstallPlanInput): InstallPlan[];
/** Run a supported one-click plan and return the raw result; never retries. */
export declare function runInstallPlan(plan: InstallPlan, opts?: {
    spawnImpl?: typeof spawn;
    timeoutMs?: number;
}): Promise<InstallRunResult>;
