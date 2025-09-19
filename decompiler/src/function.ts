import type { FunctionHeader } from "./bitfields.ts";
import { Instruction } from "./instruction.ts";

export type ExceptionHandler = [number, number, number];
export type DebugOffsets = [number, number, number];

export type PartialFunctionHeader = Pick<
    FunctionHeader,
    | "paramCount"
    | "functionName"
    | "frameSize"
    | "environmentSize"
    | "highestReadCacheIndex"
    | "highestWriteCacheIndex"
    | "prohibitInvoke"
    | "strictMode"
>;

export class HermesFunction {
    debugOffsets?: DebugOffsets;
    exceptionHandlers: ExceptionHandler[] = [];

    constructor(
        public id: number,
        public bytecodeId: number,
        public header: PartialFunctionHeader,
        public bytecode: Uint8Array,
        public jumpTables?: Uint8Array,
    ) {}

    *instructions() {
        const bc = this.bytecode;
        const view = new DataView(bc.buffer, bc.byteOffset, bc.byteLength);

        let ip = 0;
        while (ip < bc.byteLength) {
            const instr = new Instruction(ip, view);
            ip += instr.width;

            yield instr;
        }
    }
}

export interface Bytecode {
    instructions(): Generator<Instruction>;
}
