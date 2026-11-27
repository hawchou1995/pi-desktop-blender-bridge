import type { SessionRecord } from './types.js';
export interface PresencePush {
    instanceId: string;
    agents: Record<string, unknown>[];
    paused: boolean;
}
export type PresencePublisher = (push: PresencePush) => void;
export declare function setPresencePublisher(next: PresencePublisher | null): void;
export declare function publishPresence(session: SessionRecord, rows: Record<string, unknown>[]): void;
