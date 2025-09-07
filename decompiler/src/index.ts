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

export type DebugOffset = [sourceLocation: number, scopeDescriptor: number, callees: number];

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
    const header = parseHeader(new Uint8Array(buffer, 0, 128));
    const segments = mapValues(segmentFile(header), p => new Uint8Array(buffer, ...p));

    const functionHeaders = smallFunctionHeader.parseArray(
        segments.functionHeaders,
        header.functionCount,
    );

    const stringTable = stringTableEntry.parseArray(
        segments.stringTable,
        header.stringCount,
    );

    const overflowStringTable = offsetLengthPair.parseArray(
        segments.overflowStringTable,
        header.overflowStringCount,
    );

    const strings = stringTable.map(({ isUtf16, length, offset }) => {
        if (length === 0xff) ({ length, offset } = overflowStringTable[offset]);

        const slice = segments.stringStorage.subarray(offset, offset + (isUtf16 ? length * 2 : length));

        return (isUtf16 ? Utf16D : Utf8D).decode(slice);
    });

    const bigIntTable = offsetLengthPair.parseArray(segments.bigIntTable, header.bigIntCount);

    const bigInts = bigIntTable.map(({ offset, length }) => (
        toBigInt(segments.bigIntStorage.subarray(offset, offset + length))
    ));

    for (const smallHeader of functionHeaders) {
        if (!smallHeader.overflowed) continue;

        const largeHeader = largeFunctionHeader.parse(
            new Uint8Array(buffer, getLargeOffset(smallHeader), largeFunctionHeader.byteSize),
        );

        Object.assign(smallHeader, largeHeader);
        smallHeader.overflowed = 1;
    }

    const view = new DataView(buffer);

    const functions = functionHeaders.map(header => {
        let i = header.infoOffset;
        if (header.overflowed) i += largeFunctionHeader.byteSize;

        let exceptionHandler: number | undefined;
        if (header.hasExceptionHandler) {
            exceptionHandler = view.getUint32(i, true);
            i += 4;
        }

        let debugOffset: DebugOffset | undefined;
        if (header.hasDebugInfo) {
            debugOffset = [
                view.getUint32(i, true),
                view.getUint32(i + 4, true),
                view.getUint32(i + 8, true),
            ];
        }

        return {
            header,
            bytecode: new Uint8Array(buffer, header.offset, header.bytecodeSizeInBytes),
            exceptionHandler,
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

const getLargeOffset = (smallHeader: FunctionHeader) => ((smallHeader.infoOffset << 16) | smallHeader.offset) >>> 0;
