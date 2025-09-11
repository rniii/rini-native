import { fromEntries, mapValues, padSize, toBigInt } from "../../utils/index.ts";
import {
    type FunctionHeader,
    functionSourceEntry,
    identifierHash,
    largeFunctionHeader,
    offsetLengthPair,
    smallFunctionHeader,
    stringKind,
    stringTableEntry,
} from "./bitfields.ts";
import type { Opcode } from "./opcodes.ts";

export type DebugOffset = [sourceLocation: number, scopeDescriptor: number, callees: number];
export type ExceptionHandler = [start: number, end: number, target: number];

export type BytecodeHeader = ReturnType<typeof parseHeader>;
export type BytecodeModule = ReturnType<typeof parseModule>;
export type BytecodeFunction = BytecodeModule["functions"][number];
export type BytecodeSegment = keyof ReturnType<typeof segmentFile>;

export const HERMES_VERSION = 96;
export const HERMES_SIGNATURE = 0x1F1903C103BC1FC6n;

export function parseHeader(data: Uint8Array) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    if (view.getBigUint64(0, true) !== HERMES_SIGNATURE) {
        throw Error("Not a Hermes bytecode file");
    }

    const version = view.getUint32(8, true);

    if (version !== HERMES_VERSION) {
        console.warn(`Hermes file has version ${version}, expected ${HERMES_VERSION}`);
    }

    return {
        version,
        hash: new Uint8Array(view.buffer, 12, 20).slice(0),
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

export function segmentFile(header: BytecodeHeader) {
    let i = 128;

    return mapValues({
        functionHeaders: header.functionCount * smallFunctionHeader.byteSize,
        stringKinds: header.stringKindCount * stringKind.byteSize,
        identifierHashes: header.identifierCount * identifierHash.byteSize,
        stringTable: header.stringCount * stringTableEntry.byteSize,
        overflowStringTable: header.overflowStringCount * offsetLengthPair.byteSize,
        stringStorage: header.stringStorageSize * 1,
        arrayBuffer: header.arrayBufferSize * 1,
        objectKeyBuffer: header.objKeyBufferSize * 1,
        objectValueBuffer: header.objValueBufferSize * 1,
        bigIntTable: header.bigIntCount * offsetLengthPair.byteSize,
        bigIntStorage: header.bigIntStorageSize * 1,
        regExpTable: header.regExpCount * offsetLengthPair.byteSize,
        regExpStorage: header.regExpStorageSize * 1,
        cjsModuleTable: header.cjsModuleCount * offsetLengthPair.byteSize,
        functionSourceTable: header.functionSourceCount * functionSourceEntry.byteSize,
    }, (size) => {
        const offset = i;
        i += padSize(size);
        return [offset, size] as [number, number];
    });
}

export function parseModule(buffer: ArrayBuffer) {
    const view = new DataView(buffer);

    const header = parseHeader(new Uint8Array(buffer, 0, 128));
    const segments = mapValues(segmentFile(header), p => new Uint8Array(buffer, ...p));

    const functionHeaders = smallFunctionHeader.parseArray(segments.functionHeaders);

    const stringTable = stringTableEntry.parseArray(segments.stringTable);

    const overflowStringTable = offsetLengthPair.parseArray(segments.overflowStringTable);

    const strings = stringTable.map(({ isUtf16, length, offset }) => {
        if (length === 0xff) ({ length, offset } = overflowStringTable[offset]);

        const slice = segments.stringStorage.subarray(offset, offset + (isUtf16 ? length * 2 : length));

        return (isUtf16 ? Utf16D : Utf8D).decode(slice);
    });

    const bigIntTable = offsetLengthPair.parseArray(segments.bigIntTable);

    const bigInts = bigIntTable.map(({ offset, length }) => (
        toBigInt(segments.bigIntStorage.subarray(offset, offset + length))
    ));

    for (const smallHeader of functionHeaders) {
        if (!smallHeader.overflowed) continue;

        const largeHeader = largeFunctionHeader.parse(view, getLargeOffset(smallHeader));

        Object.assign(smallHeader, largeHeader);
        smallHeader.overflowed = 1;
    }

    const functions = functionHeaders.map(header => {
        let offset = header.infoOffset;
        if (header.overflowed) offset += largeFunctionHeader.byteSize;

        let exceptionHandlers = [] as ExceptionHandler[];
        if (header.hasExceptionHandler) {
            const count = view.getUint32(offset, true);
            offset += 4;

            for (let i = 0; i < count; ++i) {
                exceptionHandlers.push([
                    view.getUint32(offset, true),
                    view.getUint32(offset + 4, true),
                    view.getUint32(offset + 8, true),
                ]);
                offset += 12;
            }
        }

        let debugOffset: DebugOffset | undefined;
        if (header.hasDebugInfo) {
            debugOffset = [
                view.getUint32(offset, true),
                view.getUint32(offset + 4, true),
                view.getUint32(offset + 8, true),
            ];
            offset += 12;
        }

        const bytecode = new Uint8Array(buffer, header.offset, header.bytecodeSizeInBytes);

        return {
            header,
            bytecode,
            exceptionHandlers,
            debugOffset,
        };
    });

    return {
        header,
        segments,
        functions,
        strings,
        bigInts,
        buffer,
    };
}

const Utf8D = new TextDecoder("utf-8");
const Utf16D = new TextDecoder("utf-16");

function getLargeOffset(smallHeader: FunctionHeader) {
    return ((smallHeader.infoOffset << 16) | smallHeader.offset) >>> 0;
}
