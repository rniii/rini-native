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
import { HermesFunction, HermesIdentifier, HermesModule, HermesString } from "./types.ts";

// https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeVersion.h#L23
const HERMES_VERSION = 96;

// https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeFileFormat.h#L27
const HERMES_SIGNATURE = 0x1F1903C103BC1FC6n;

// From now on also reference:
// https://github.com/facebook/hermes/blob/v0.13.0/lib/BCGen/HBC/BytecodeStream.cpp
//
// Some assumptions are made about the file layout based on Hermes' own serializer. This means that
// while *technically* you could create a file which runs on Hermes but can't be parsed here, their
// compiler would never output bytecode which violates this layout.

export function parseHermesModule(buffer: ArrayBuffer): HermesModule {
    const module = new HermesModule();

    const view = new DataView(buffer);
    const header = parseHeader(buffer);
    const segments = segmentModule(header, buffer);

    module.sourceHash = header.hash;
    module.globalCodeIndex = header.globalCodeIndex;
    module.segmentID = header.segmentID;
    module.options = header.options;
    module.segments = {
        identifierHashes: segments.identifierHashes,
        arrayBuffer: segments.arrayBuffer,
        objectKeyBuffer: segments.objectKeyBuffer,
        objectValueBuffer: segments.objectValueBuffer,
        cjsModules: segments.cjsModuleTable,
        functionSources: segments.functionSourceTable,
    };

    const functionHeaders = smallFunctionHeader.parseArray(segments.functionHeaders);

    for (const header of functionHeaders) {
        if (!header.overflowed) continue;

        const largeHeader = largeFunctionHeader.parse(view, getLargeOffset(header));
        largeHeader.overflowed = 1;
        Object.assign(header, largeHeader);
    }

    const stringKinds = stringKind.parseArray(segments.stringKinds);
    const stringTable = stringTableEntry.parseArray(segments.stringTable);
    const overflowStringTable = offsetLengthPair.parseArray(segments.overflowStringTable);

    module.strings = stringTable.map((entry, i) => {
        const { isUtf16 } = entry;
        const { length, offset } = entry.length === 0xff
            ? overflowStringTable[entry.offset]
            : entry;

        const { kind } = findRLEIndex(stringKinds, i)!;
        const bytes = segments.stringStorage.subarray(offset, offset + length * (isUtf16 ? 2 : 1));

        return kind === 1
            ? new HermesIdentifier(i, bytes, !!isUtf16)
            : new HermesString(i, bytes, !!isUtf16);
    });

    const bigIntTable = offsetLengthPair.parseArray(segments.bigIntTable);

    module.bigInts = bigIntTable.map(({ offset, length }) => (
        toBigInt(segments.bigIntStorage.subarray(offset, offset + length))
    ));

    const regExpTable = offsetLengthPair.parseArray(segments.regExpTable);

    module.regExps = regExpTable.map(({ offset, length }) => (
        segments.regExpStorage.subarray(offset, offset + length)
    ));

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

    module.functions = functionHeaders.map((header, i) => {
        let offset = header.infoOffset;
        if (header.overflowed) offset += largeFunctionHeader.byteSize;

        const bytecode = new Uint8Array(buffer, header.offset, header.bytecodeSizeInBytes);

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

        const func = new HermesFunction(i, header, bytecode, jumpTables);

        if (header.hasExceptionHandler) {
            const count = view.getUint32(offset, true);
            offset += 4;

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

    // bytecode ends at the first function info, offsets are always increasing in order
    module.bytecode = new Uint8Array(
        buffer,
        module.functions[0].header.offset,
        module.functions[0].header.infoOffset - module.functions[0].header.offset,
    );

    // debug info is followed by a 20 byte SHA-1 hash, which we don't check
    module.debugInfo = new Uint8Array(
        buffer,
        header.debugInfoOffset,
        buffer.byteLength - header.debugInfoOffset - 20,
    );

    return module;
}

function findRLEIndex<T extends { count: number }>(arr: T[], index: number): T | undefined {
    return arr.find(x => (index -= x.count) < 0);
}

function getLargeOffset(smallHeader: FunctionHeader) {
    return ((smallHeader.infoOffset << 16) | smallHeader.offset) >>> 0;
}

function segmentModule(header: Header, buffer: ArrayBuffer) {
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
        return new Uint8Array(buffer, offset, size);
    });
}

type Header = ReturnType<typeof parseHeader>;

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
