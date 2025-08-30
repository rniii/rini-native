import { Bitfield, type ParsedBitfield } from "./Bitfield.ts";

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

export type FunctionHeader = ParsedBitfield<typeof largeFunctionHeader>;

export const stringKind = new Bitfield({
  count: 31,
  kind: 1,
});

export type StringKind = ParsedBitfield<typeof stringKind>;

export const identifierHash = new Bitfield({
  hash: 32,
});

export type IdentifierHash = ParsedBitfield<typeof identifierHash>;

export const stringTableEntry = new Bitfield({
  isUtf16: 1,
  offset: 23,
  length: 8,
});

export type StringTableEntry = ParsedBitfield<typeof stringTableEntry>;

export const offsetLengthPair = new Bitfield({
  offset: 32,
  length: 32,
});

export type OffsetLengthPair = ParsedBitfield<typeof offsetLengthPair>;

export const functionSourceEntry = new Bitfield({
  functionId: 32,
  stringId: 32,
});

export type FunctionSourceEntry = ParsedBitfield<typeof functionSourceEntry>;
