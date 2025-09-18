import { entries, padSize } from "../../utils/index.ts";
import {
    type FunctionHeader,
    identifierHash,
    largeFunctionHeader,
    type OffsetLengthPair,
    offsetLengthPair,
    smallFunctionHeader,
    type StringKind,
    stringKind,
    type StringTableEntry,
    stringTableEntry,
} from "./bitfields.ts";
import { type Header, HERMES_SIGNATURE, HERMES_VERSION, segmentModule } from "./moduleParser.ts";
import { HermesIdentifier, type HermesModule } from "./types.ts";

export function writeHermesModule(module: HermesModule) {
    const stringKinds: StringKind[] = [];

    let curKind: StringKind | undefined;
    for (const string of module.strings) {
        const kind = string instanceof HermesIdentifier ? 1 : 0;

        if (curKind && curKind!?.kind === kind) {
            curKind.count++;
        } else {
            stringKinds.push(curKind = { count: 1, kind });
        }
    }

    const {
        stringStorage = new Uint8Array(),
        bigIntTable = new Uint8Array(),
        bigIntStorage = new Uint8Array(),
        regExpTable = new Uint8Array(),
        regExpStorage = new Uint8Array(),
        arrayBuffer = new Uint8Array(),
        objectKeyBuffer = new Uint8Array(),
        objectValueBuffer = new Uint8Array(),
    } = module.segments;

    const overflowStringTable: OffsetLengthPair[] = [];

    const stringTable: StringTableEntry[] = module.strings.map(string => {
        const isUtf16 = +string.isUtf16;

        let offset = string.bytes.byteOffset - stringStorage.byteOffset;
        let length = string.bytes.byteLength / (isUtf16 ? 2 : 1);

        if (offset >= 1 << stringTableEntry.fields.offset || length >= 0xff) {
            overflowStringTable.push({ offset, length });

            offset = overflowStringTable.length - 1;
            length = 0xff;
        }

        return { isUtf16, offset, length };
    });

    const header: Header = {
        version: HERMES_VERSION,
        hash: module.sourceHash ?? new Uint8Array(20),
        fileLength: 0, // to be filled
        globalCodeIndex: module.globalCodeIndex,
        functionCount: module.functions.length,
        stringKindCount: stringKinds.length,
        identifierCount: module.identifierHashes.byteLength / identifierHash.byteSize,
        stringCount: module.strings.length,
        overflowStringCount: overflowStringTable.length,
        stringStorageSize: stringStorage.byteLength,
        bigIntCount: module.bigInts.length,
        bigIntStorageSize: bigIntStorage.byteLength,
        regExpCount: module.regExps.length,
        regExpStorageSize: regExpStorage.byteLength,
        arrayBufferSize: arrayBuffer.byteLength,
        objKeyBufferSize: objectKeyBuffer.byteLength,
        objValueBufferSize: objectValueBuffer.byteLength,
        segmentID: module.segmentID,
        cjsModuleCount: module.cjsModuleTable.byteLength / offsetLengthPair.byteSize,
        functionSourceCount: module.functionSourceTable.byteLength / offsetLengthPair.byteSize,
        debugInfoOffset: 0, // to be filled
        options: module.options,
    };

    const segments = segmentModule(header);

    let offset = segments.bytecodeStart[0];

    const bcMap = new Map<number, number>();

    for (const func of module.functions) {
        const bcOffset = bcMap.get(func.bytecodeId) ?? offset;

        func.header.offset = bcOffset;
        func.header.bytecodeSizeInBytes = func.bytecode.byteLength;
        func.header.hasExceptionHandler = +!!func.exceptionHandlers.length;
        func.header.hasDebugInfo = +!!func.debugOffsets;
        func.header.overflowed = +smallFunctionHeader.overflows(func.header as FunctionHeader);

        if (func.bytecodeId > 0 && bcMap.has(func.bytecodeId)) continue;

        bcMap.set(func.bytecodeId, offset);

        offset += func.bytecode.byteLength;

        if (func.jumpTables) {
            offset = padSize(offset);
            offset += func.jumpTables.byteLength;
        }
    }

    offset = padSize(offset);

    for (const func of module.functions) {
        func.header.infoOffset = offset;

        if (func.header.overflowed) offset += largeFunctionHeader.byteSize;
        if (func.exceptionHandlers.length) offset += 4 + func.exceptionHandlers.length * 12;
        if (func.debugOffsets) offset += 12;
    }

    if (module.debugInfo) {
        header.debugInfoOffset = offset;
        offset += module.debugInfo.byteLength;
    }

    const fileLength = header.fileLength = offset + 20;

    // everything up until now is only to calculate the correct offsets within the file :D
    // worth it for only doing a single allocation B)

    const buffer = new ArrayBuffer(fileLength);
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);

    view.setBigUint64(0, HERMES_SIGNATURE, true);

    offset = 8;
    for (const [field, value] of entries(header)) {
        if (field === "hash") {
            data.set(value as Uint8Array, offset);
            offset += 20;
        } else {
            view.setUint32(offset, value as number, true);
            offset += 4;
        }
    }

    offset = segments.functionHeaders[0];
    for (const func of module.functions) {
        if (func.header.overflowed) {
            writeOverflowedHeader(view, offset, func.header as FunctionHeader);
        } else {
            smallFunctionHeader.write(view, offset, func.header as FunctionHeader);
        }
        offset += smallFunctionHeader.byteSize;
    }

    stringKind.writeItems(view, segments.stringKinds[0], stringKinds);
    stringTableEntry.writeItems(view, segments.stringTable[0], stringTable);
    offsetLengthPair.writeItems(view, segments.overflowStringTable[0], overflowStringTable);

    for (
        const [segment, [offset]] of [
            [module.identifierHashes, segments.identifierHashes],
            [stringStorage, segments.stringStorage], // TODO
            [arrayBuffer, segments.arrayBuffer], // TODO
            [objectKeyBuffer, segments.objectKeyBuffer], // TODO
            [objectValueBuffer, segments.objectValueBuffer], // TODO
            [bigIntTable, segments.bigIntTable], // TODO
            [bigIntStorage, segments.bigIntStorage], // TODO
            [regExpTable, segments.regExpTable], // TODO
            [regExpStorage, segments.regExpStorage], // TODO
            [module.cjsModuleTable, segments.cjsModuleTable],
            [module.functionSourceTable, segments.functionSourceTable],
        ]
    ) {
        data.set(segment, offset);
    }

    let lastOffset = segments.bytecodeStart[0];
    for (const func of module.functions) {
        offset = func.header.offset!;
        if (offset < lastOffset) continue; // deduped

        lastOffset = offset;

        data.set(func.bytecode, offset);
        offset += func.bytecode.byteLength;

        if (func.jumpTables) {
            offset = padSize(offset);
            data.set(func.jumpTables, offset);
        }
    }

    for (const func of module.functions) {
        offset = func.header.infoOffset!;

        if (func.header.overflowed) {
            func.header.overflowed = 0;
            largeFunctionHeader.write(view, offset, func.header as FunctionHeader);

            offset += largeFunctionHeader.byteSize;
        }
        if (func.exceptionHandlers.length) {
            view.setUint32(offset, func.exceptionHandlers.length, true);
            offset += 4;

            for (const handler of func.exceptionHandlers) {
                view.setUint32(offset, handler[0], true);
                view.setUint32(offset + 4, handler[1], true);
                view.setUint32(offset + 8, handler[2], true);
                offset += 12;
            }
        }
        if (func.debugOffsets) {
            view.setUint32(offset, func.debugOffsets[0], true);
            view.setUint32(offset + 4, func.debugOffsets[1], true);
            view.setUint32(offset + 8, func.debugOffsets[2], true);
            offset += 12;
        }
    }

    if (module.debugInfo) data.set(module.debugInfo, header.debugInfoOffset);

    return data;
}

// this SUCKS
function writeOverflowedHeader(view: DataView, offset: number, smallheader: FunctionHeader) {
    const copy = {} as FunctionHeader;

    for (const [field, { mask }] of smallFunctionHeader.segments) {
        if (smallheader[field] > mask) break;

        copy[field] = smallheader[field];
    }

    copy.offset = (smallheader.infoOffset & 0xffff) >>> 0;
    copy.infoOffset = smallheader.infoOffset >>> 16;

    copy.prohibitInvoke = smallheader.prohibitInvoke;
    copy.strictMode = smallheader.strictMode;
    copy.hasExceptionHandler = smallheader.hasExceptionHandler;
    copy.hasDebugInfo = smallheader.hasDebugInfo;
    copy.overflowed = 1;

    smallFunctionHeader.write(view, offset, copy);
}
