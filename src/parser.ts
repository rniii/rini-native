import type { FileHandle } from "fs/promises";
import { fromEntries, lazyPromise, parseBitfield, toBigInt } from "@/utils";

export async function readHeader(handle: FileHandle) {
  const MAGIC = 0x1F1903C103BC1FC6n;

  let i = 0;
  const buffer = Buffer.alloc(128);
  await handle.read(buffer, 0);

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
};

export async function readFile(handle: FileHandle) {
  const header = await readHeader(handle)

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
      functionHeaders: segment(header.functionCount * 16),
      stringKinds: segment(header.stringKindCount * 4),
      identifierHashes: segment(header.identifierCount * 4),
      stringTable: segment(header.stringCount * 4),
      overflowStringTable: segment(header.overflowStringCount * 8),
      stringStorage: segment(header.stringStorageSize),
      arrayBuffer: segment(header.arrayBufferSize),
      objectKeyBuffer: segment(header.objKeyBufferSize),
      objectValueBuffer: segment(header.objValueBufferSize),
      bigIntTable: segment(header.bigIntCount * 8),
      bigIntStorage: segment(header.bigIntStorageSize),
      regExpTable: segment(header.regExpCount * 8),
      regExpStorage: segment(header.regExpStorageSize),
      cjsModuleTable: segment(header.cjsModuleCount * 8),
      functionSourceTable: segment(header.functionSourceCount * 8),
    }
  };
}

export type BytecodeFile = Awaited<ReturnType<typeof readFile>>
export type BytecodeFileSegment = keyof BytecodeFile['segments']

export function parseFile(file: BytecodeFile) {
  const parser = {
    functionHeaders: lazyPromise(async () => {
      const buffer = await file.segments.functionHeaders

      return Promise.all(Array.from({ length: file.header.functionCount }, (_, i) => (
        parseFunctionHeader(buffer.subarray(i * 16, (i + 1) * 16), file)
      )))
    }),
    stringTable: lazyPromise(async () => {
      const buffer = await file.segments.stringTable

      return Array.from({ length: file.header.stringCount }, (_, i) => (
        parseStringTableEntry(buffer.subarray(i * 12, (i + 1) * 12))
      ))
    }),
    overflowStringTable: lazyPromise(async () => {
      const buffer = await file.segments.overflowStringTable

      return Array.from({ length: file.header.overflowStringCount }, (_, i) => (
        parseOffsetLengthPair(buffer.subarray(i * 8, (i + 1) * 8))
      ))
    }),
    stringStorage: lazyPromise(async () => {
      const buffer = await file.segments.stringStorage
      const table = await parser.stringTable
      const overflowStringTable = await parser.overflowStringTable

      const strings: string[] = [];
      for (let i = 0; i < file.header.stringCount; i++) {
        let { isUtf16, length, offset } = table[i]

        if (length === 0xFF) {
          if (!overflowStringTable[offset]) {
            console.log('invalid entry stringTable[%o]', i, table[i])
          }
          ({ length, offset } = overflowStringTable[offset])
        }
        if (isUtf16) length *= 2

        const slice = buffer.subarray(offset, offset + length)

        strings.push(slice.toString(isUtf16 ? 'utf16le' : 'utf8'))
      }

      return strings
    }),
    bigIntTable: lazyPromise(async () => {
      const buffer = await file.segments.bigIntTable

      return Array.from({ length: file.header.bigIntCount }, (_, i) => (
        parseOffsetLengthPair(buffer.subarray(i * 8, (i + 1) * 8))
      ))
    }),
    bigIntStorage: lazyPromise(async () => {
      const buffer = await file.segments.bigIntStorage
      const table = await parser.bigIntTable

      return Array.from({ length: file.header.bigIntCount }, (_, i): BigInt => {
        const { offset, length } = table[i]
        return toBigInt(buffer.subarray(offset, offset + length))
      })
    }),
    functionSourceTable: lazyPromise(async () => {
      const buffer = await file.segments.functionSourceTable

      return Array.from({ length: file.header.overflowStringCount }, (_, i) => (
        parseFunctionSourceEntry(buffer.subarray(i * 8, (i + 1) * 8))
      ))
    }),
  } satisfies Record<BytecodeFileSegment, PromiseLike<any>>

  return parser
}

export function parseSmallFunctionHeader(buffer: Buffer) {
  const parsed = parseBitfield(buffer, {
    offset: 25,
    paramCount: 7,
    bytecodeSizeInBytes: 15,
    functionName: 17,
    infoOffset: 25,
    frameSize: 7,
    environmentSize: 8,
    highestReadCacheIndex: 8,
    highestWriteCacheIndex: 8,
  });

  const flags = parseBitfield(buffer.subarray(15, 16), {
    prohibitInvoke: 2,
    strictMode: 1,
    hasExceptionHandler: 1,
    hasDebugInfo: 1,
    overflowed: 1,
  });

  return Object.assign(parsed, { flags })
}
export function parseLargeFunctionHeader(buffer: Buffer) {
  const parsed = parseBitfield(buffer, {
    offset: 32,
    paramCount: 32,
    bytecodeSizeInBytes: 32,
    functionName: 32,
    infoOffset: 32,
    frameSize: 32,
    environmentSize: 32,
    highestReadCacheIndex: 8,
    highestWriteCacheIndex: 8,
  });

  const flags = parseBitfield(buffer.subarray(30, 31), {
    prohibitInvoke: 2,
    strictMode: 1,
    hasExceptionHandler: 1,
    hasDebugInfo: 1,
    overflowed: 1,
  });

  return Object.assign(parsed, { flags })
}

export async function parseFunctionHeader(buffer: Buffer, file: BytecodeFile) {
  const smallHeader = parseSmallFunctionHeader(buffer)

  if (smallHeader.flags.overflowed) {
    buffer = Buffer.alloc(32)
    await file.handle.read(buffer, 0, 32, (smallHeader.infoOffset * 0x10000) | smallHeader.offset)

    return parseLargeFunctionHeader(buffer)
  }

  return smallHeader
}

export function parseStringTableEntry(buffer: Buffer) {
  return parseBitfield(buffer, {
    isUtf16: 1,
    offset: 23,
    length: 8,
  });
}

export function parseOffsetLengthPair(buffer: Buffer) {
  return parseBitfield(buffer, {
    offset: 32,
    length: 32,
  });
}

export function parseFunctionSourceEntry(buffer: Buffer) {
  return parseBitfield(buffer, {
    functionId: 32,
    stringId: 32,
  });
}

