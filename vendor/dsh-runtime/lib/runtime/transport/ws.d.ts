export declare const OP_CONTINUATION = 0;
export declare const OP_TEXT = 1;
export declare const OP_BINARY = 2;
export declare const OP_CLOSE = 8;
export declare const OP_PING = 9;
export declare const OP_PONG = 10;
export declare const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export declare const DEFAULT_MAX_MESSAGE_BYTES: number;
export interface WsFrame {
    fin: boolean;
    opcode: number;
    payload: Buffer;
}
export interface ParsedFrames {
    frames: WsFrame[];
    rest: Buffer;
    error?: string;
}
/** Sec-WebSocket-Accept for a client key. */
export declare function acceptKey(key: string): string;
export interface EncodeOptions {
    mask?: boolean;
    fin?: boolean;
    maskKey?: Buffer;
}
/** Encode one unmasked (server) or masked (client) frame. */
export declare function encodeFrame(opcode: number, payload?: Buffer | string, opts?: EncodeOptions): Buffer;
export declare function encodeText(text: string, opts?: EncodeOptions): Buffer;
export declare function encodeClose(code?: number, reason?: string, opts?: EncodeOptions): Buffer;
/**
 * Parse as many complete frames as the buffer holds. Never throws on hostile
 * input: returns an error string and the unparsed remainder.
 */
export declare function parseFrames(input: Buffer, opts?: {
    requireMask?: boolean;
    maxMessageBytes?: number;
}): ParsedFrames;
export declare function closePayload(payload: Buffer): {
    code: number | null;
    reason: string;
};
