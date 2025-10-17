export type ExceptionHandler = [number, number, number];
export type DebugOffsets = [number, number, number];

export enum ProhibitInvoke {
    /** Must be called with `new` (constructor) */
    ProhibitCall,
    /** Cannot be called with `new` (ES6 arrow, class method) */
    ProhibitConstruct,
    /** No restriction (regular function) */
    ProhibitNone,
}

export interface PartialFunctionHeader {
    paramCount: number;
    functionName: number;
    /** Register count[?] */
    frameSize: number;
    /** Size of `CreateEnvironment` slots */
    environmentSize: number;
    /** Highest slot used in `GetById`-family opcodes */
    highestReadCacheIndex: number;
    /** Highest slot used in `PutById`-family opcodes */
    highestWriteCacheIndex: number;
    /** Prohibits calling with/without `new`, or not at all */
    prohibitInvoke: ProhibitInvoke;
    /** Set to 1 if `"use strict";` applies to this function */
    strictMode: number;
}

export interface ModuleBytecode {
    opcodes: Uint8Array;
    jumpTables?: Uint8Array;
}

export interface ModuleFunction {
    id: number;
    header: PartialFunctionHeader;
    bytecode: ModuleBytecode;
    exceptionHandlers: ExceptionHandler[] | undefined;
    debugOffsets: DebugOffsets | undefined;
}
