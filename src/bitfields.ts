import { createBitfieldParser, instrument } from "./utils";

export const functionHeaderFlagFields = {
  prohibitInvoke: 2,
  strictMode: 1,
  hasExceptionHandler: 1,
  hasDebugInfo: 1,
  overflowed: 1,
};

export const pointerFunctionHeader = createBitfieldParser({
  offsetLow: 25,
  _pad: 7 + 15 + 17,
  offsetHigh: 25,
});

pointerFunctionHeader.parse = instrument("pointerFunctionHeader", pointerFunctionHeader.parse);

export const smallFunctionHeader = createBitfieldParser({
  offset: 25,
  paramCount: 7,
  bytecodeSizeInBytes: 15,
  functionName: 17,
  infoOffset: 25,
  frameSize: 7,
  environmentSize: 8,
  highestReadCacheIndex: 8,
  highestWriteCacheIndex: 8,

  ...functionHeaderFlagFields,
});

smallFunctionHeader.parse = instrument("smallFunctionHeader", smallFunctionHeader.parse);

export const largeFunctionHeader = createBitfieldParser({
  offset: 32,
  paramCount: 32,
  bytecodeSizeInBytes: 32,
  functionName: 32,
  infoOffset: 32,
  frameSize: 32,
  environmentSize: 32,
  highestReadCacheIndex: 8,
  highestWriteCacheIndex: 8,

  ...functionHeaderFlagFields,
});

largeFunctionHeader.parse = instrument("largeFunctionHeader", largeFunctionHeader.parse);

export const stringKind = createBitfieldParser({
  count: 31,
  kind: 1,
});

export const identifierHash = createBitfieldParser({
  hash: 32,
});

export const stringTableEntry = createBitfieldParser({
  isUtf16: 1,
  offset: 23,
  length: 8,
});

export const offsetLengthPair = createBitfieldParser({
  offset: 32,
  length: 32,
});

export const functionSourceEntry = createBitfieldParser({
  functionId: 32,
  stringId: 32,
});
