import type { EngineApiDeps } from './index.js';
/**
 * addon 侧阶段预算。宿主 backendJson 默认 20s、T.commands 静态截止 60s；
 * 这里的预算必须落在宿主之前，否则模型只拿到 aborted，看不到任何结构化诊断。
 */
/**
 * /status 的 bpy 往返（REGION_CODE）预算：2.5s。
 *
 * extension/bpy 的硬超时 <=3s，首调失败的第 95 百分位 <=3s；Gateway 路径的传输诊断是
 * 同步的实例表判定（不再串 legacy 9876 的 ~2.5s diagnose），所以半开 addon 的
 * /status 稳态 = 2.5s + 路由开销，落在预算内。
 */
export declare const ADDON_STATUS_TIMEOUT_MS = 2500;
/** /doctor 的 status 阶段预算：2.5s；复用 statusView 的同源 readiness，不重复探测。 */
export declare const ADDON_DOCTOR_STATUS_TIMEOUT_MS = 2500;
/** /commands 的 FLAGS 预算：2s（单层硬超时；commands 断连的 socket closed 不再叠加重试）。 */
export declare const ADDON_FLAGS_TIMEOUT_MS = 2000;
/** /commands 单个集成 status 预算：1.5s；五个集成并行，总代价不随数量线性增长。 */
export declare const ADDON_INTEGRATION_TIMEOUT_MS = 1500;
/** 是否"等不到 addon 回包"类错误（超时/被 abort）：把失败归因到 extension/bpy 而不是后端进程。 */
export declare function isAddonTimeout(e: unknown): boolean;
export declare function statusView(E: EngineApiDeps, opts?: {
    addonTimeoutMs?: number;
}): Promise<Record<string, unknown>>;
/**
 * （PR review）：addon 明确回了错误（非超时）时的归因。
 * 这类失败说明通道在（TCP 通、addon 有响应），不要归成 main-thread-busy / blender-unreachable。
 */
export declare function addonErrorDiagnosis(error: string): Record<string, unknown>;
export declare function createDoctorApi(E: EngineApiDeps): {
    protocol(): Promise<{
        proto: {
            id: string;
            label: string;
            panelHint: string;
        };
        from: string;
    }>;
    /** 现场体检：真跑一次 Gateway → addon → bpy 往返（status），通了才算 ok。 */
    doctor(): Promise<{
        ok: boolean;
        addon: {
            kind: string;
            stage: string;
            summary: string;
            fix: string;
        };
        virtualGui: Record<string, unknown>;
        metrics: Record<string, unknown>;
        error: string;
    } | {
        virtualGui: import("../../display/types.js").DisplayCapabilities;
        ok?: undefined;
        addon?: undefined;
        metrics?: undefined;
        error?: undefined;
    }>;
    /** 3D 视口区域 rect / 窗口尺寸 / 着色模式 */
    status(): Promise<Record<string, unknown>>;
    commands(): Promise<{
        scene: unknown;
        file: unknown;
        total: number;
        available: string[];
        disabled: string[];
        gates: Record<string, unknown>;
        integrations: Record<string, unknown>;
        commands: {
            name: string;
            description: string;
            access: "read" | "internal";
            gate: string | null;
            enabled: boolean;
            pause_safe: boolean;
            network: boolean;
            args: any[];
        }[];
    }>;
};
