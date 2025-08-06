import type { FileHandle } from "node:fs/promises";
import { parseHeader, segmentFile } from "../decompiler/src";
import { entries, fromEntries, lazyPromise, toBigInt } from "../utils";
import type { ParsedBitfield } from "../decompiler/src/Bitfield";
import {
  functionSourceEntry,
  identifierHash,
  largeFunctionHeader,
  offsetLengthPair,
  smallFunctionHeader,
  stringKind,
  stringTableEntry,
} from "../decompiler/src/bitfields";

export async function readHeader(handle: FileHandle) {
  const data = Buffer.alloc(128);
  await handle.read(data, 0, 128, 0);

  return parseHeader(data.buffer);
}

export async function readFile(handle: FileHandle) {
  const header = await readHeader(handle);
  const segments = fromEntries(
    entries(segmentFile(header)).map(([name, [offset, size]]) => [
      name,
      lazyPromise(async () => {
        const buf = Buffer.alloc(size);
        await handle.read(buf, 0, size, offset);
        return buf;
      }),
    ])
  );

  return { header, handle, segments };
}

export type BytecodeFile = Awaited<ReturnType<typeof readFile>>;
export type BytecodeFileSegment = keyof BytecodeFile["segments"];

export function parseFile(file: BytecodeFile) {
  const parser = {
    smallFunctionHeaders: lazyPromise(async () => {
      const buffer = await file.segments.functionHeaders;

      return Array.from({ length: file.header.functionCount }, (_, i) => (
        smallFunctionHeader.parseElement(buffer, i)
      ));
    }),
    functionHeaders: lazyPromise(async () => {
      const table: ParsedBitfield<typeof smallFunctionHeader>[] = await parser.smallFunctionHeaders;

      const range: [number, number] = [Infinity, 0];
      for (const smallHeader of table) {
        if (!smallHeader.overflowed) continue;

        const largeOffset = (smallHeader.infoOffset * 0x10000) | smallHeader.offset;
        range[0] = Math.min(range[0], largeOffset);
        range[1] = Math.max(range[1], largeOffset + largeFunctionHeader.byteSize);
      }

      let buffer = Buffer.alloc(0);
      if (Number.isFinite(range[0])) {
        buffer = Buffer.alloc(range[1] - range[0]);
        await file.handle.read(buffer, 0, buffer.length, range[0]);
      }

      return Array.from({ length: file.header.functionCount }, (_, i) => {
        const smallHeader = table[i];
        if (!smallHeader.overflowed) return smallHeader;

        const largeOffset = ((smallHeader.infoOffset * 0x10000) | smallHeader.offset) - range[0];
        return largeFunctionHeader.parse(buffer.subarray(largeOffset, largeOffset + largeFunctionHeader.byteSize));
      });
    }),
    stringKinds: lazyPromise(async () => {
      const buffer = await file.segments.stringKinds;

      return Array.from({ length: file.header.stringCount }, (_, i) => (
        stringKind.parseElement(buffer, i)
      ));
    }),
    identifierHashes: lazyPromise(async () => {
      const buffer = await file.segments.identifierHashes;

      return Array.from({ length: file.header.identifierCount }, (_, i) => (
        identifierHash.parseElement(buffer, i)
      ));
    }),
    stringTable: lazyPromise(async () => {
      const buffer = await file.segments.stringTable;

      return Array.from({ length: file.header.stringCount }, (_, i) => (
        stringTableEntry.parseElement(buffer, i)
      ));
    }),
    overflowStringTable: lazyPromise(async () => {
      const buffer = await file.segments.overflowStringTable;

      return Array.from({ length: file.header.overflowStringCount }, (_, i) => (
        offsetLengthPair.parseElement(buffer, i)
      ));
    }),
    stringStorage: lazyPromise(async () => {
      const buffer = await file.segments.stringStorage;
      const table = await parser.stringTable;
      const overflowStringTable = await parser.overflowStringTable;

      const strings: string[] = [];
      for (let i = 0; i < file.header.stringCount; i++) {
        let { isUtf16, length, offset } = table[i];

        if (length === 0xFF) {
          if (!overflowStringTable[offset]) {
            console.log("invalid entry stringTable[%o]", i, table[i]);
          }
          ({ length, offset } = overflowStringTable[offset]);
        }
        if (isUtf16) length *= 2;

        const slice = buffer.subarray(offset, offset + length);

        strings.push(slice.toString(isUtf16 ? "utf16le" : "utf8"));
      }

      return strings;
    }),
    bigIntTable: lazyPromise(async () => {
      const buffer = await file.segments.bigIntTable;

      return Array.from({ length: file.header.bigIntCount }, (_, i) => (
        offsetLengthPair.parseElement(buffer, i)
      ));
    }),
    bigIntStorage: lazyPromise(async () => {
      const buffer = await file.segments.bigIntStorage;
      const table: ParsedBitfield<typeof offsetLengthPair>[] = await parser.bigIntTable;

      return Array.from({ length: file.header.bigIntCount }, (_, i) => {
        const { offset, length } = table[i];
        return toBigInt(buffer.subarray(offset, offset + length));
      });
    }),
    regExpTable: lazyPromise(async () => {
      const buffer = await file.segments.regExpTable;

      return Array.from({ length: file.header.regExpCount }, (_, i) => (
        offsetLengthPair.parseElement(buffer, i)
      ));
    }),
    regExpStorage: lazyPromise(async () => {
      const buffer = await file.segments.regExpStorage;
      const table = await parser.regExpTable;

      return Array.from({ length: file.header.regExpCount }, (_, i): Buffer => {
        const { offset, length } = table[i];
        return buffer.subarray(offset, offset + length); // TODO: regex bytecode parser
      });
    }),
    functionSourceTable: lazyPromise(async () => {
      const buffer = await file.segments.functionSourceTable;

      return Array.from({ length: file.header.overflowStringCount }, (_, i) => (
        functionSourceEntry.parseElement(buffer, i)
      ));
    }),
  };

  return parser;
}
