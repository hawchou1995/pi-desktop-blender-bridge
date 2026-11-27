import type { AgentPresence, CallerIdentity, SessionRecord, ViewPose } from './types.js';
export declare function touchAgent(s: SessionRecord, c: CallerIdentity): AgentPresence;
export declare function setView(s: SessionRecord, c: CallerIdentity, view: Omit<ViewPose, 'updatedAt'>): Record<string, unknown>[];
export declare function setSelection(s: SessionRecord, c: CallerIdentity, selected: string[], activity?: string): Record<string, unknown>[];
export declare function presenceRows(s: SessionRecord): Record<string, unknown>[];
