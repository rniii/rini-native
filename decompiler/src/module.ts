import { fromEntries, mapValues, padSize, toBigInt } from "../../utils/index.ts";
import {
    type FunctionHeader,
    functionSourceEntry,
    identifierHash,
    largeFunctionHeader,
    offsetLengthPair,
    smallFunctionHeader,
    type StringKind,
    stringKind,
    type StringTableEntry,
    stringTableEntry,
} from "./bitfields.ts";
import { ModuleBytecode, type ModuleFunction } from "./function.ts";

// https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeVersion.h#L23
export const HERMES_VERSION = 96;

// https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeFileFormat.h#L27
export const HERMES_SIGNATURE = 0x1F1903C103BC1FC6n;

// From now on also reference:
// https://github.com/facebook/hermes/blob/v0.13.0/lib/BCGen/HBC/BytecodeStream.cpp
//
// Some assumptions are made about the file layout based on Hermes' own serializer. This means that
// while *technically* you could create a file which runs on Hermes but can't be parsed here, their
// compiler would never output bytecode which violates this layout.

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

export type UniqueString = { id: number; contents: string };

const Utf8D = new TextDecoder("utf-8");
const Utf16D = new TextDecoder("utf-16");

export class StringTable extends DataTable<UniqueString> {
    declare entries: StringTableEntry[];

    constructor(
        storage: Uint8Array,
        entries: StringTableEntry[],
        public overflowEntries: Entry[],
        public kinds: StringKind[],
    ) {
        super(storage, entries);
    }

    get(index: number): UniqueString {
        const entry = this.entries[index];

        const { isUtf16 } = entry;
        const { length, offset } = entry.length === 0xff
            ? this.overflowEntries[entry.offset]
            : entry;

        const bytes = this.storage.subarray(offset, offset + length * (isUtf16 ? 2 : 1));

        return { id: index, contents: isUtf16 ? Utf16D.decode(bytes) : Utf8D.decode(bytes) };
    }
}

export class BigIntTable extends DataTable<bigint> {
    get(index: number): bigint {
        const { offset, length } = this.entries[index];

        return toBigInt(this.storage.subarray(offset, offset + length));
    }
}

export class RegExpTable extends DataTable<never> {
    get(): never {
        throw Error("Not implemented");
    }
}

export class HermesModule {
    sourceHash: Uint8Array;
    globalCodeIndex: number;
    segmentID: number;
    options: number;

    // some segments which are not parsed, but are written back to patched files
    identifierHashes: Uint8Array;
    cjsModuleTable: Uint8Array;
    functionSourceTable: Uint8Array;
    debugInfo?: Uint8Array;

    arrayBuffer: Uint8Array;
    objectKeyBuffer: Uint8Array;
    objectValueBuffer: Uint8Array;

    strings: StringTable;
    bigInts: BigIntTable;
    regExps: RegExpTable;

    bytecode: ModuleBytecode[];
    functions: ModuleFunction[];

    constructor(
        header: Header,
        segments: Record<Segment, Uint8Array>,
        buffer: ArrayBuffer,
    ) {
        this.sourceHash = header.hash;
        this.globalCodeIndex = header.globalCodeIndex;
        this.segmentID = header.segmentID;
        this.options = header.options;

        this.identifierHashes = segments.identifierHashes;
        this.cjsModuleTable = segments.cjsModuleTable;
        this.functionSourceTable = segments.functionSourceTable;

        this.arrayBuffer = segments.arrayBuffer;
        this.objectKeyBuffer = segments.objectKeyBuffer;
        this.objectValueBuffer = segments.objectValueBuffer;

        if (header.debugInfoOffset) {
            // debug info is followed by a 20 byte SHA-1 hash, which we don't check
            this.debugInfo = new Uint8Array(
                buffer,
                header.debugInfoOffset,
                buffer.byteLength - header.debugInfoOffset - 20,
            );
        }

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

        [this.bytecode, this.functions] = parseFunctions(segments, buffer);
    }
}

export function parseHermesModule(buffer: ArrayBuffer) {
    const header = parseHeader(buffer);
    const segments = mapValues(segmentModule(header), p => new Uint8Array(buffer, ...p));

    return new HermesModule(header, segments, buffer);
}

function parseFunctions(segments: Record<Segment, Uint8Array>, buffer: ArrayBuffer) {
    const view = new DataView(buffer);

    const functionHeaders = smallFunctionHeader.parseArray(segments.functionHeaders);

    for (const header of functionHeaders) {
        if (!header.overflowed) continue;

        const largeHeader = largeFunctionHeader.parse(view, getLargeOffset(header));
        largeHeader.overflowed = 1;
        Object.assign(header, largeHeader);
    }

    // here we basically assume that any gaps between function bytecodes are jump tables
    // it looks very silly, i know
    // https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/Bytecode.h#L47

    const bytecodeLengths = new Map<number, number>();

    let lastOffset;
    for (const { offset } of functionHeaders) {
        if (bytecodeLengths.has(offset)) continue;

        bytecodeLengths.set(offset, 0);

        if (lastOffset != null) {
            bytecodeLengths.set(lastOffset, offset - lastOffset);
        }

        lastOffset = offset;
    }

    // first infoOffset always follows last function's bytecode
    if (lastOffset) bytecodeLengths.set(lastOffset, functionHeaders[0].infoOffset - lastOffset);

    // deduplicate bytecode
    const bytecodes = new Map<number, ModuleBytecode>();
    const functions = functionHeaders.map((header, id) => {
        let bytecode = bytecodes.get(header.offset);

        if (!bytecode) {
            const bytes = new Uint8Array(buffer, header.offset, header.bytecodeSizeInBytes);
            const extraBytes = bytecodeLengths.get(header.offset)! - header.bytecodeSizeInBytes;
            let jumpTables;

            if (extraBytes > 0) {
                const tableStart = header.offset + header.bytecodeSizeInBytes;
                // jump table starts at next 4-byte aligned address
                const alignBytes = tableStart % 4 === 0 ? 0 : 4 - (tableStart % 4);

                if (extraBytes > alignBytes) {
                    jumpTables = new Uint8Array(buffer, tableStart + alignBytes, extraBytes - alignBytes);
                } else {
                    // probably the last function
                }
            }

            bytecode = new ModuleBytecode(bytes, jumpTables);
            bytecodes.set(header.offset, bytecode);
        }

        const func: ModuleFunction = {
            id, header, bytecode,
            exceptionHandlers: undefined,
            debugOffsets: undefined,
        };

        let offset = header.infoOffset;
        if (header.overflowed) offset += largeFunctionHeader.byteSize;

        if (header.hasExceptionHandler) {
            const count = view.getUint32(offset, true);
            offset += 4;

            func.exceptionHandlers = [];
            for (let i = 0; i < count; ++i) {
                func.exceptionHandlers.push([
                    view.getUint32(offset, true),
                    view.getUint32(offset + 4, true),
                    view.getUint32(offset + 8, true),
                ]);
                offset += 12;
            }
        }

        if (header.hasDebugInfo) {
            func.debugOffsets = [
                view.getUint32(offset, true),
                view.getUint32(offset + 4, true),
                view.getUint32(offset + 8, true),
            ];
            offset += 12;
        }

        return func;
    });

    return [[...bytecodes.values()], functions] as [ModuleBytecode[], ModuleFunction[]];
}

function getLargeOffset(smallHeader: FunctionHeader) {
    return ((smallHeader.infoOffset << 16) | smallHeader.offset) >>> 0;
}

export type Segment = keyof ReturnType<typeof segmentModule>;

export function segmentModule(header: Header) {
    let i = 128;

    return mapValues({
        functionHeaders: header.functionCount * smallFunctionHeader.byteSize,
        stringKinds: header.stringKindCount * stringKind.byteSize,
        identifierHashes: header.identifierCount * identifierHash.byteSize,
        stringTable: header.stringCount * stringTableEntry.byteSize,
        overflowStringTable: header.overflowStringCount * offsetLengthPair.byteSize,
        stringStorage: header.stringStorageSize,
        arrayBuffer: header.arrayBufferSize,
        objectKeyBuffer: header.objKeyBufferSize,
        objectValueBuffer: header.objValueBufferSize,
        bigIntTable: header.bigIntCount * offsetLengthPair.byteSize,
        bigIntStorage: header.bigIntStorageSize,
        regExpTable: header.regExpCount * offsetLengthPair.byteSize,
        regExpStorage: header.regExpStorageSize,
        cjsModuleTable: header.cjsModuleCount * offsetLengthPair.byteSize,
        functionSourceTable: header.functionSourceCount * functionSourceEntry.byteSize,
        bytecodeStart: 0,
    }, size => {
        const offset = i;
        i += padSize(size);
        return [offset, size];
    });
}

export type Header = ReturnType<typeof parseHeader>;

export function parseHeader(buffer: ArrayBuffer) {
    const view = new DataView(buffer);

    if (view.getBigUint64(0, true) !== HERMES_SIGNATURE) {
        throw Error("Not a Hermes bytecode file");
    }

    const version = view.getUint32(8, true);

    if (version !== HERMES_VERSION) {
        console.warn(`Hermes file has version ${version}, expected ${HERMES_VERSION}`);
    }

    return {
        version,
        hash: new Uint8Array(view.buffer, 12, 20).slice(),
        ...fromEntries(([
            "fileLength",
            "globalCodeIndex",
            "functionCount",
            "stringKindCount",
            "identifierCount",
            "stringCount",
            "overflowStringCount",
            "stringStorageSize",
            "bigIntCount",
            "bigIntStorageSize",
            "regExpCount",
            "regExpStorageSize",
            "arrayBufferSize",
            "objKeyBufferSize",
            "objValueBufferSize",
            "segmentID",
            "cjsModuleCount",
            "functionSourceCount",
            "debugInfoOffset",
            "options",
        ] as const).map((k, i) => [k, view.getUint32(32 + i * 4, true)])),
    };
}
