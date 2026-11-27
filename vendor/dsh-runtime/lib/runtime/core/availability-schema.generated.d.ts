export declare const AVAILABILITY_SCHEMA_VERSION = 1;
export declare const AVAILABILITY_STAGES: readonly ["config", "session", "spawn", "transport", "handshake", "addon", "bpy", "queue", "render"];
export type AvailabilityStage = (typeof AVAILABILITY_STAGES)[number];
export declare const AVAILABILITY_REQUIRED_FIELDS: readonly ["stage", "root_cause", "fix", "fallback", "evidence"];
export type AvailabilityRequiredField = (typeof AVAILABILITY_REQUIRED_FIELDS)[number];
export declare const AVAILABILITY_FALLBACK_KINDS: readonly ["unavailable", "degraded"];
export type AvailabilityFallbackKind = (typeof AVAILABILITY_FALLBACK_KINDS)[number];
export declare const AVAILABILITY_BUDGETS_MS: {
    readonly config: 100;
    readonly session: 100;
    readonly spawn: 250;
    readonly transport: 3000;
    readonly handshake: 3000;
    readonly addon: 3000;
    readonly bpy: 3000;
    readonly queue: 3000;
    readonly render: 3000;
};
