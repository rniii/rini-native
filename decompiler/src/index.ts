import type { FunctionHeader } from "./bitfields.ts";

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
    exceptionHandlers = [] as ExceptionHandler[];

    constructor(
        public header: FunctionHeader,
        public bytecode: Uint8Array,
        public jumpTables?: Uint8Array,
    ) {}
}

export class HermesString {
    constructor(
        public bytes: Uint8Array,
        public isUtf16: boolean,
    ) {}
}

export class HermesIdentifier extends HermesString {}
