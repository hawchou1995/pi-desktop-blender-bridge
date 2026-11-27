export interface CommandCatalogEntry {
    d: string;
    gate: string | null;
    access: 'read' | 'internal';
}
export declare const COMMAND_CATALOG: Record<string, CommandCatalogEntry>;
export declare const COMMAND_CATALOG_OMISSIONS: readonly string[];
