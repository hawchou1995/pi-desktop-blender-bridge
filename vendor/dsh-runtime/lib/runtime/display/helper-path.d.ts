export declare const HELPER_EXE = "dsh-blender-hidden-desktop.exe";
export interface HelperResolution {
    path: string | null;
    source: string;
    checked: string[];
    detail: string;
}
export interface HelperResolveOptions {
    env?: NodeJS.ProcessEnv;
    pkgRoot?: string;
}
export declare function isHelperFile(file: string): boolean;
export declare function resolveHiddenDesktopHelper(options?: HelperResolveOptions): HelperResolution;
