import type { PresencePush } from '../core/sessions/presence-publish.js';
import type { GatewayAddonClient } from '../transport/addon-ws.js';
export declare function presenceCode(push: PresencePush): string;
export declare function installPresencePublisher(client: GatewayAddonClient): void;
