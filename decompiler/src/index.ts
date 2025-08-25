import { fromEntries, mapValues, padSize } from "../../utils/index.ts";
import {
  functionSourceEntry,
  identifierHash,
  offsetLengthPair,
  smallFunctionHeader,
  stringKind,
  stringTableEntry,
  type SmallFunctionHeader,
} from "./bitfields.ts";

export const HERMES_SIGNATURE = 0x1F1903C103BC1FC6n;

export function parseHeader(buffer: ArrayBuffer) {
  const view = new DataView(buffer);

  if (view.getBigUint64(0, true) !== HERMES_SIGNATURE) {
    throw Error("Not a Hermes bytecode file");
  }

  return {
    version: view.getUint32(8, true),
    // hash: new Uint8Array(view.buffer.slice(0), 12, 20),
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

export type HermesHeader = ReturnType<typeof parseHeader>;

export function segmentFile(header: HermesHeader) {
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

export function segmentBody(header: HermesHeader, smallFunctionHeaders: SmallFunctionHeader[]) {
  const largeFunctionHeaders = [1 / 0, 0];
  const functionBytecode = [1 / 0, 0];

  for (const header of smallFunctionHeaders) {
    if (header) {}
  }
}

export type HermesSegments = keyof ReturnType<typeof segmentFile>;
