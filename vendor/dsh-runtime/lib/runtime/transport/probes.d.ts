export interface AddonClient {
    ensure(): Promise<void>;
    send(type: string, params?: Record<string, unknown>, timeoutMs?: number, opts?: {
        instanceId?: string;
        noMark?: boolean;
    }): Promise<unknown>;
    close(): void;
}
