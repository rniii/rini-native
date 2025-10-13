import { Instruction } from "./instruction.ts";

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

export class ModuleBytecode {
    constructor(
        public bytes: Uint8Array,
        public jumpTables?: Uint8Array,
    ) {}

    *instructions() {
        const bc = this.bytes;
        const view = new DataView(bc.buffer, bc.byteOffset, bc.byteLength);

        let ip = 0;
        while (ip < bc.byteLength) {
            const instr = new Instruction(ip, view);
            ip += instr.width;

            yield instr;
        }
    }
}

export interface ModuleFunction {
    id: number;
    header: PartialFunctionHeader;
    bytecode: ModuleBytecode;
    exceptionHandlers: ExceptionHandler[] | undefined;
    debugOffsets: DebugOffsets | undefined;
}
