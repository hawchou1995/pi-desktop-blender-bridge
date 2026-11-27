export interface GatewayOwner {
    gatewayId: string;
    hostId: string;
    pid: number;
    endpoint: string;
    startedAt: number;
    port?: number;
}
export declare function gatewayStatePath(port: number): string;
export declare function writeGatewayOwner(owner: GatewayOwner): void;
export declare function removeGatewayOwner(port: number): void;
/** Exported for tests / host status: read the owner state file of a port. */
export declare function readGatewayOwner(port: number): GatewayOwner | null;
export declare function gatewayHostId(): string;
