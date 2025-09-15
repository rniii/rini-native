import type { FunctionHeader } from "./bitfields.ts";
import { Instruction } from "./instruction.ts";

export { Instruction } from "./instruction.ts";
export { parseHermesModule } from "./moduleParser.ts";

export type ExceptionHandler = [number, number, number];
export type DebugOffsets = [number, number, number];

export class HermesModule {
    globalCodeIndex = 0;
    segmentID = 0;
    options = 0;
    debugInfo?: Uint8Array;
    sourceHash?: Uint8Array;

    // File segments which are currently not handled
    segments: Record<string, Uint8Array> = {};

    strings: HermesString[] = [];
    bigInts: bigint[] = [];
    regExps: Uint8Array[] = [];

    functions: HermesFunction[] = [];

    bytecode?: Uint8Array;
    bytecodeOffsets: number[] = [];
}

export class HermesFunction {
    debugOffsets?: DebugOffsets;
    exceptionHandlers: ExceptionHandler[] = [];

    constructor(
        public id: number,
        public header: FunctionHeader,
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

export class HermesString {
    contents: string;

    constructor(
        public id: number,
        public bytes: Uint8Array,
        public isUtf16: boolean,
    ) {
        this.contents = (isUtf16 ? Utf16D : Utf8D).decode(bytes);
    }
}

const Utf8D = new TextDecoder("utf-8");
const Utf16D = new TextDecoder("utf-16");

export class HermesIdentifier extends HermesString {}
