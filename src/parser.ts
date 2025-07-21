import { fromEntries, lazyPromise, toBigInt } from "@/utils";
import type { FileHandle } from "fs/promises";
import {
  functionSourceEntry,
  identifierHash,
  largeFunctionHeader,
  offsetLengthPair,
  smallFunctionHeader,
  stringKind,
  stringTableEntry,
} from "./bitfields";

export async function readHeader(handle: FileHandle) {
  const MAGIC = 0x1F1903C103BC1FC6n;

  let i = 0;
  const buffer = Buffer.alloc(128);
  await handle.read(buffer, 0, 128, 0);

  const read64 = () => {
    let v = buffer.readBigInt64LE(i);
    return i += 8, v;
  };
  const read32 = () => {
    let v = buffer.readInt32LE(i);
    return i += 4, v;
  };
  const read8 = () => buffer.readInt8(i++);
  const readHash = () => {
    let v = buffer.subarray(i, i += 20);
    return v;
  };

  console.assert(read64() == MAGIC, "Not a Hermes bytecode file");

  return {
    version: read32(),
    sourceHash: readHash().toString("hex"),
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
    ] as const).map(k => [k, read32()])),
    options: read8().toString(8).padStart(8, "0"),
  };
}

export async function readFile(handle: FileHandle) {
  const header = await readHeader(handle);

  let i = 128;
  const segment = (size: number) => {
    const segmentOffset = i;
    i += size;
    return lazyPromise(async () => {
      const buf = Buffer.alloc(size);
      await handle.read(buf, 0, size, segmentOffset);
      return buf;
    });
  };

  return {
    header,
    handle,
    segments: {
      functionHeaders: segment(header.functionCount * smallFunctionHeader.byteSize),
      stringKinds: segment(header.stringKindCount * stringKind.byteSize),
      identifierHashes: segment(header.identifierCount * identifierHash.byteSize),
      stringTable: segment(header.stringCount * stringTableEntry.byteSize),
      overflowStringTable: segment(header.overflowStringCount * offsetLengthPair.byteSize),
      stringStorage: segment(header.stringStorageSize),
      arrayBuffer: segment(header.arrayBufferSize),
      objectKeyBuffer: segment(header.objKeyBufferSize),
      objectValueBuffer: segment(header.objValueBufferSize),
      bigIntTable: segment(header.bigIntCount * offsetLengthPair.byteSize),
      bigIntStorage: segment(header.bigIntStorageSize),
      regExpTable: segment(header.regExpCount * offsetLengthPair.byteSize),
      regExpStorage: segment(header.regExpStorageSize),
      cjsModuleTable: segment(header.cjsModuleCount * offsetLengthPair.byteSize),
      functionSourceTable: segment(header.functionSourceCount * functionSourceEntry.byteSize),
    },
  };
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
      const table = await parser.smallFunctionHeaders

      return Promise.all(Array.from({ length: file.header.functionCount }, async (_, i) => {
        const smallHeader = table[i]
        if (smallHeader.overflowed) {
          const buffer = Buffer.alloc(32);
          await file.handle.read(buffer, 0, 32, (smallHeader.infoOffset * 0x10000) | smallHeader.offset);

          return largeFunctionHeader.parse(buffer);
        }
      }));
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
      const table = await parser.bigIntTable;

      return Array.from({ length: file.header.bigIntCount }, (_, i): BigInt => {
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
  }

  return parser;
}
