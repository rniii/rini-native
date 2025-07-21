import { Bitfield } from "./Bitfield";
import { instrument } from "./utils";

export const functionHeaderFlagFields = {
  prohibitInvoke: 2,
  strictMode: 1,
  hasExceptionHandler: 1,
  hasDebugInfo: 1,
  overflowed: 1,
};

export const smallFunctionHeader = new Bitfield({
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

smallFunctionHeader.parse = instrument("smallFunctionHeader", smallFunctionHeader.parse.bind(smallFunctionHeader));

export const largeFunctionHeader = new Bitfield({
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

largeFunctionHeader.parse = instrument("largeFunctionHeader", largeFunctionHeader.parse.bind(largeFunctionHeader));

export const stringKind = new Bitfield({
  count: 31,
  kind: 1,
});

export const identifierHash = new Bitfield({
  hash: 32,
});

export const stringTableEntry = new Bitfield({
  isUtf16: 1,
  offset: 23,
  length: 8,
});

export const offsetLengthPair = new Bitfield({
  offset: 32,
  length: 32,
});

export const functionSourceEntry = new Bitfield({
  functionId: 32,
  stringId: 32,
});
