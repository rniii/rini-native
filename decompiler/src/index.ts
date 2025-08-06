import { fromEntries } from "../../utils";
import {
  functionSourceEntry,
  identifierHash,
  offsetLengthPair,
  smallFunctionHeader,
  stringKind,
  stringTableEntry,
} from "./bitfields";

export function parseHeader(buffer: ArrayBuffer) {
  const MAGIC = 0x1F1903C103BC1FC6n;

  const view = new DataView(buffer);

  console.assert(view.getBigUint64(0, true) == MAGIC, "Not a Hermes bytecode file");

  return {
    version: view.getUint32(8, true),
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

  return fromEntries(([
    ["functionHeaders", header.functionCount * smallFunctionHeader.byteSize],
    ["stringKinds", header.stringKindCount * stringKind.byteSize],
    ["identifierHashes", header.identifierCount * identifierHash.byteSize],
    ["stringTable", header.stringCount * stringTableEntry.byteSize],
    ["overflowStringTable", header.overflowStringCount * offsetLengthPair.byteSize],
    ["stringStorage", header.stringStorageSize * 1],
    ["arrayBuffer", header.arrayBufferSize * 1],
    ["objectKeyBuffer", header.objKeyBufferSize * 1],
    ["objectValueBuffer", header.objValueBufferSize * 1],
    ["bigIntTable", header.bigIntCount * offsetLengthPair.byteSize],
    ["bigIntStorage", header.bigIntStorageSize * 1],
    ["regExpTable", header.regExpCount * offsetLengthPair.byteSize],
    ["regExpStorage", header.regExpStorageSize * 1],
    ["cjsModuleTable", header.cjsModuleCount * offsetLengthPair.byteSize],
    ["functionSourceTable", header.functionSourceCount * functionSourceEntry.byteSize],
  ] as const).map(([name, size]) => {
    const offset = i;
    i += size;
    return [name, [offset, size]];
  }));
}

export type HermesSegments = keyof ReturnType<typeof segmentFile>;
