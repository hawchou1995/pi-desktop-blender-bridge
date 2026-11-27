export interface PlanFamily {
    f: string;
    prefix: string;
    /** 3.1 target surface: G (GUI session) requires a ready session; L (host-local) does not. */
    requires_session: boolean;
    /** Max write scope a family may request when it mutates the scene; 'none' for host-local families. */
    write_scope: 'exclusive' | 'none';
    when: string;
    not: string;
    sk: string;
    ops: string[];
    key: string;
}
export interface DiskCatalog {
    ok: boolean;
    error?: string;
    catalogHash?: string;
    families?: number;
    opsCount?: number;
    pluginVersion?: unknown;
    [k: string]: unknown;
}
export declare const PLAN_CATALOG: PlanFamily[];
/** plan 之外的顶层工具：先决定"用哪个工具"，再决定 op */
/**
 * 描述预算：重工具的参数长尾（从工具描述里搬出来的那部分）。
 * 取用：blender_op(op="catalog", args={tool:"blender_run"})（后端本地直出）
 * 动机：15 个工具的 schema 是每轮固定开销；模型在"调用那一刻"只需要参数名 + 一句说明。
 * 维护：工具描述里删掉的解释性文字往这里放，别让它悄悄涨回去（tests/unit/js/contract/description-budget.test.ts 有预算门）。
 */
/** 全部已知 plan op 名（带 family 前缀，便于最近邻） */
export declare function planOpNames(): string[];
export declare const PLAN_TOOL_MAP: Array<{
    t: string;
    use: string;
}>;
export declare const PLAN_READ_ONLY_OPS: string[];
export declare const PLAN_READ_ONLY: Set<string>;
