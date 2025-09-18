import { toBigInt } from "../../utils/index.ts";
import {
    type FunctionHeader,
    offsetLengthPair,
    type StringKind,
    stringKind,
    type StringTableEntry,
    stringTableEntry,
} from "./bitfields.ts";
import { Instruction } from "./instruction.ts";
import type { Segment } from "./moduleParser.ts";

export { Instruction, isValidOpcode, type ParsedArguments, type ParsedInstruction } from "./instruction.ts";

export type ExceptionHandler = [number, number, number];
export type DebugOffsets = [number, number, number];

export type Literal = number | string | boolean | null;

export type Entry = { offset: number; length: number };

export abstract class DataTable<T> {
    length: number;

    constructor(public storage: Uint8Array, public entries: Entry[]) {
        this.length = entries.length;
    }

    abstract get(index: number): T;

    *[Symbol.iterator]() {
        let i = 0;
        while (i < this.entries.length) {
            yield this.get(i++);
        }
    }
}

export class StringTable extends DataTable<HermesString> {
    declare entries: StringTableEntry[];

    constructor(
        storage: Uint8Array,
        entries: StringTableEntry[],
        public overflowEntries: Entry[],
        public kinds: StringKind[],
    ) {
        super(storage, entries);
    }

    get(index: number): HermesString {
        const entry = this.entries[index];

        const { isUtf16 } = entry;
        const { length, offset } = entry.length === 0xff
            ? this.overflowEntries[entry.offset]
            : entry;

        const { kind } = findRLEIndex(this.kinds, index)!;
        const bytes = this.storage.subarray(offset, offset + length * (isUtf16 ? 2 : 1));

        return kind === 1
            ? new HermesIdentifier(index, bytes, !!isUtf16)
            : new HermesString(index, bytes, !!isUtf16);
    }
}

export class BigIntTable extends DataTable<bigint> {
    get(index: number): bigint {
        const { offset, length } = this.entries[index];

        return toBigInt(this.storage.subarray(offset, offset + length));
    }
}

export class RegExpTable extends DataTable<Uint8Array> {
    get(index: number): Uint8Array {
        const { offset, length } = this.entries[index];

        return this.storage.subarray(offset, offset + length);
    }
}

function findRLEIndex<T extends { count: number }>(arr: T[], index: number): T | undefined {
    return arr.find(x => (index -= x.count) < 0);
}

export class HermesModule {
    sourceHash?: Uint8Array;
    globalCodeIndex = 0;
    segmentID = 0;
    options = 0;

    // some segments which are not parsed, but may be written back to a patched file
    identifierHashes = new Uint8Array();
    cjsModuleTable = new Uint8Array();
    functionSourceTable = new Uint8Array();
    debugInfo?: Uint8Array;

    arrayBuffer = new Uint8Array();
    objectKeyBuffer = new Uint8Array();
    objectValueBuffer = new Uint8Array();

    strings: StringTable;
    bigInts: BigIntTable;
    regExps: RegExpTable;

    constructor(
        segments: Record<Segment, Uint8Array>,
        public functions: HermesFunction[], // TODO: inconsistent with other sections
    ) {
        this.strings = new StringTable(
            segments.stringStorage,
            stringTableEntry.parseArray(segments.stringTable),
            offsetLengthPair.parseArray(segments.overflowStringTable),
            stringKind.parseArray(segments.stringKinds),
        );
        this.bigInts = new BigIntTable(
            segments.bigIntStorage,
            offsetLengthPair.parseArray(segments.bigIntTable),
        );
        this.regExps = new RegExpTable(
            segments.regExpStorage,
            offsetLengthPair.parseArray(segments.regExpTable),
        );
    }
}

export type PartialFunctionHeader =
    & Pick<
        FunctionHeader,
        | "paramCount"
        | "functionName"
        | "frameSize"
        | "environmentSize"
        | "highestReadCacheIndex"
        | "highestWriteCacheIndex"
        | "prohibitInvoke"
        | "strictMode"
    >
    & Partial<FunctionHeader>;

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

const Utf8D = new TextDecoder("utf-8");
const Utf16D = new TextDecoder("utf-16");

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

export class HermesIdentifier extends HermesString {}

export interface Bytecode {
    instructions(): Generator<Instruction>;
}
