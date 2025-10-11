import { entries, padSize } from "../../utils/index.ts";
import {
    type FunctionHeader,
    identifierHash,
    largeFunctionHeader,
    offsetLengthPair,
    smallFunctionHeader,
    stringKind,
    stringTableEntry,
} from "./bitfields.ts";
import { type Header, HERMES_SIGNATURE, HERMES_VERSION, segmentModule } from "./module.ts";
import { type HermesModule, ModuleBytecode } from "./types.ts";

export function writeHermesModule(module: HermesModule) {
    const header: Header = {
        version: HERMES_VERSION,
        hash: module.sourceHash,
        fileLength: 0, // to be filled
        globalCodeIndex: module.globalCodeIndex,
        functionCount: module.functions.length,
        stringKindCount: module.strings.kinds.length,
        identifierCount: module.identifierHashes.byteLength / identifierHash.byteSize,
        stringCount: module.strings.length,
        overflowStringCount: module.strings.overflowEntries.length,
        stringStorageSize: module.strings.storage.byteLength,
        bigIntCount: module.bigInts.length,
        bigIntStorageSize: module.bigInts.storage.byteLength,
        regExpCount: module.regExps.length,
        regExpStorageSize: module.regExps.storage.byteLength,
        arrayBufferSize: module.arrayBuffer.byteLength,
        objKeyBufferSize: module.objectKeyBuffer.byteLength,
        objValueBufferSize: module.objectValueBuffer.byteLength,
        segmentID: module.segmentID,
        cjsModuleCount: module.cjsModuleTable.byteLength / offsetLengthPair.byteSize,
        functionSourceCount: module.functionSourceTable.byteLength / offsetLengthPair.byteSize,
        debugInfoOffset: 0, // to be filled
        options: module.options,
    };

    const segments = segmentModule(header);

    let offset = segments.bytecodeStart[0];

    const bcMap = new Map<ModuleBytecode, number>();

    for (const bytecode of module.bytecode) {
        bcMap.set(bytecode, offset);

        offset += bytecode.bytes.byteLength;
        if (bytecode.jumpTables) {
            offset = padSize(offset);
            offset += bytecode.jumpTables.byteLength;
        }
    }

    const funcHeaders: FunctionHeader[] = module.functions.map(func => ({
        ...func.header,
        offset: bcMap.get(func.bytecode)!,
        bytecodeSizeInBytes: func.bytecode.bytes.byteLength,
        infoOffset: 0,
        hasExceptionHandler: +!!func.exceptionHandlers.length,
        hasDebugInfo: +!!func.debugOffsets,
        overflowed: 0,
    }));

    offset = padSize(offset);

    const smallHeaders: FunctionHeader[] = [];

    for (const [i, func] of module.functions.entries()) {
        const header = funcHeaders[i];
        header.infoOffset = offset;

        const small = getSmallHeader(header);
        smallHeaders.push(small);

        if (smallHeaders[i].overflowed) offset += largeFunctionHeader.byteSize;
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

    smallFunctionHeader.writeItems(view, segments.functionHeaders[0], smallHeaders);
    stringKind.writeItems(view, segments.stringKinds[0], module.strings.kinds);
    stringTableEntry.writeItems(view, segments.stringTable[0], module.strings.entries);
    offsetLengthPair.writeItems(view, segments.overflowStringTable[0], module.strings.overflowEntries);
    offsetLengthPair.writeItems(view, segments.bigIntTable[0], module.bigInts.entries);
    offsetLengthPair.writeItems(view, segments.regExpTable[0], module.regExps.entries);

    for (
        const [segment, [offset]] of [
            [module.identifierHashes, segments.identifierHashes],
            [module.strings.storage, segments.stringStorage],
            [module.arrayBuffer, segments.arrayBuffer], // TODO
            [module.objectKeyBuffer, segments.objectKeyBuffer], // TODO
            [module.objectValueBuffer, segments.objectValueBuffer], // TODO
            [module.bigInts.storage, segments.bigIntStorage],
            [module.regExps.storage, segments.regExpStorage],
            [module.cjsModuleTable, segments.cjsModuleTable],
            [module.functionSourceTable, segments.functionSourceTable],
        ]
    ) {
        data.set(segment, offset);
    }

    for (let [bytecode, offset] of bcMap) {
        data.set(bytecode.bytes, offset);
        offset += bytecode.bytes.byteLength;

        if (bytecode.jumpTables) {
            offset = padSize(offset);
            data.set(bytecode.jumpTables, offset);
        }
    }

    for (const [i, func] of module.functions.entries()) {
        const header = funcHeaders[i];
        const smallHeader = smallHeaders[i];

        offset = header.infoOffset;

        if (smallHeader.overflowed) {
            largeFunctionHeader.write(view, offset, header);

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

function getSmallHeader(funcHeader: FunctionHeader) {
    const copy = {} as FunctionHeader;

    // copy flags first
    copy.prohibitInvoke = funcHeader.prohibitInvoke;
    copy.strictMode = funcHeader.strictMode;
    copy.hasExceptionHandler = funcHeader.hasExceptionHandler;
    copy.hasDebugInfo = funcHeader.hasDebugInfo;

    for (const [field, { mask }] of smallFunctionHeader.segments) {
        if (funcHeader[field] > mask) {
            copy.offset = (funcHeader.infoOffset & 0xffff) >>> 0;
            copy.infoOffset = funcHeader.infoOffset >>> 16;
            copy.overflowed = 1;

            return copy;
        }

        copy[field] = funcHeader[field];
    }

    return copy;
}
