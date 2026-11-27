import type { Server } from 'node:http';
import { SessionRegistry } from '../core/sessions/registry.js';
import { JobQueue } from '../core/queue/manager.js';
import { AddonGateway, GatewayAddonClient } from '../transport/addon-ws.js';
import type { EngineSurface } from '../core/engine/index.js';
import type { AddonGatewayOptions } from '../transport/addon-ws.js';
import type { GatewayOwner } from './owner.js';
export interface GatewayAppOptions extends AddonGatewayOptions {
    port?: number;
    host?: string;
}
export interface GatewayApp {
    server: Server;
    engine: EngineSurface;
    sessionRegistry: SessionRegistry;
    jobQueue: JobQueue;
    addonGateway: AddonGateway;
    addonClient: GatewayAddonClient;
    port: number;
    host: string;
    routes: string[];
    owner: GatewayOwner | null;
    close: () => void;
}
/** Build the Gateway app without listening; tests and the process entry share it. */
export declare function createGatewayApp(opts?: GatewayAppOptions): GatewayApp;
