import { fromEntries, insort, mapValues, padSize, toBigInt } from "../../utils/index.ts";
import {
  type FunctionHeader,
  functionSourceEntry,
  identifierHash,
  largeFunctionHeader,
  offsetLengthPair,
  smallFunctionHeader,
  stringKind,
  stringTableEntry,
} from "./bitfields.ts";

export type DebugOffset = [sourceLocation: number, scopeDescriptor: number, callees: number];

export interface BytecodeFunction {
  header: FunctionHeader;
  bytecode: Uint8Array;
  exceptionHandler?: number;
  debugOffset?: DebugOffset;
}

export interface BytecodeModule {
  header: BytecodeHeader;
  segments: Record<BytecodeSegment, Uint8Array>;
  functions: BytecodeFunction[];
  strings: string[];
  bigInts: bigint[];
  buffer: ArrayBuffer;
}

export type BytecodeHeader = ReturnType<typeof parseHeader>;

export type BytecodeSegment = keyof ReturnType<typeof segmentFile>;

export const HERMES_VERSION = 96;
export const HERMES_SIGNATURE = 0x1F1903C103BC1FC6n;

export function parseHeader(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (view.getBigUint64(0, true) !== HERMES_SIGNATURE) {
    throw Error("Not a Hermes bytecode file");
  }

  const version = view.getUint32(8, true);

  if (version !== HERMES_VERSION) {
    console.warn(`Hermes file has version ${version}, expected ${HERMES_VERSION}`);
  }

  return {
    version,
    hash: new Uint8Array(view.buffer, 12, 20).slice(0),
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

export function segmentFile(header: BytecodeHeader) {
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

export type SegmentReader = (
  name: string,
  byteOffset: number,
  byteLength: number,
  callback: (buffer: Uint8Array) => void,
) => void;

export async function parseModule(reader: SegmentReader): Promise<BytecodeModule> {
  let cursor = 0;

  const readChunk = <T>(name: string, position: [number, number], handler: (buffer: Uint8Array) => T) => {
    console.assert(position[0] >= cursor);

    // if (position[0] != cursor) {
    //   console.log("Gap", `${cursor}…${position[0]}`);
    // }

    cursor = position[0] + position[1];
    // console.log(name, `${position[0]}…${cursor}`);

    return new Promise<T>(resolve => reader(name, position[0], position[1], buf => resolve(handler(buf))));
  };

  const readSegment = <T>(key: BytecodeSegment, desc: string, handler: (buffer: Uint8Array) => T) =>
    readChunk(desc, segmentPositions[key], handler);

  const header = await readChunk("Hermes header", [0, 128], parseHeader);
  const segmentPositions = segmentFile(header);

  const functionHeaders = await readSegment("functionHeaders", "Function headers", buffer => (
    smallFunctionHeader.parseArray(buffer, header.functionCount)
  ));

  const stringTable = await readSegment("stringTable", "Strings", buffer => (
    stringTableEntry.parseArray(buffer, header.stringCount)
  ));

  const overflowStringTable = await readSegment("overflowStringTable", "Long strings", buffer => (
    offsetLengthPair.parseArray(buffer, header.overflowStringCount)
  ));

  const strings = await readSegment("stringStorage", "String data", buffer => {
    return stringTable.map(({ isUtf16, length, offset }) => {
      if (length === 0xff) ({ length, offset } = overflowStringTable[offset]);

      const slice = buffer.subarray(offset, offset + (isUtf16 ? length * 2 : length));

      return (isUtf16 ? Utf16D : Utf8D).decode(slice);
    });
  });

  const bigIntTable = await readSegment("bigIntTable", "BigInts", buffer => (
    offsetLengthPair.parseArray(buffer, header.bigIntCount)
  ));

  const bigInts = await readSegment("bigIntStorage", "BigInt data", buffer => {
    return bigIntTable.map(({ offset, length }) => {
      return toBigInt(buffer.subarray(offset, offset + length));
    });
  });

  if (functionHeaders[0].overflowed) {
    const overflowEnd = functionHeaders.findLastIndex(sm => sm.overflowed);

    const start = getLargeOffset(functionHeaders[0]);
    const end = getLargeOffset(functionHeaders[overflowEnd]) + largeFunctionHeader.byteSize;

    await readChunk("Overflowed headers", [start, end - start], buffer => {
      for (const smallHeader of functionHeaders) {
        if (!smallHeader.overflowed) continue;

        const largeOffset = getLargeOffset(smallHeader) - start;
        const largeHeader = largeFunctionHeader.parse(
          buffer.subarray(largeOffset, largeOffset + largeFunctionHeader.byteSize),
        );

        Object.assign(smallHeader, largeHeader);
        smallHeader.overflowed = 1;
      }
    });
  }

  const { buffer } = await readChunk("End of file", [header.fileLength, 0], b => b);

  const functions = functionHeaders.map(header => {
    let i = header.infoOffset;
    if (header.overflowed) i += largeFunctionHeader.byteSize;

    let exceptionHandler: number | undefined;
    if (header.hasExceptionHandler) {
      exceptionHandler = new Uint32Array(buffer, i, 1)[0];
      i += 4;
    }

    let debugOffset: DebugOffset | undefined;
    if (header.hasDebugInfo) {
      debugOffset = [...new Uint32Array(buffer, i, 3)] as any;
    }

    return {
      header,
      bytecode: new Uint8Array(buffer, header.offset, header.bytecodeSizeInBytes),
      exceptionHandler,
      debugOffset,
    };
  });

  const segments = mapValues(segmentPositions, p => new Uint8Array(buffer, ...p));

  return {
    header,
    segments,
    functions,
    strings,
    bigInts,
    buffer,
  };
}

export interface PendingSegment {
  name: string;
  byteOffset: number;
  byteLength: number;
  callback(buf: Uint8Array): void;
}

// cursed
export function createStreamReader(
  stream: ReadableStream,
  fileSize: number,
  hook: (buffer: ArrayBuffer, offset: number) => void = () => {},
): {
  reader: SegmentReader;
  pendingSegments: PendingSegment[];
} {
  const pendingSegments = [] as PendingSegment[];

  const reader = stream.getReader({ mode: "byob" });

  readData();

  return {
    reader(name, byteOffset, byteLength, callback) {
      const task = { name, byteOffset, byteLength, callback };
      insort(pendingSegments, task, task => task.byteOffset);
    },
    pendingSegments,
  };

  async function readData() {
    let buffer = new ArrayBuffer(fileSize);
    let offset = 0;
    let chunk: Uint8Array | undefined;

    const nextChunk = async () => {
      const { value } = await reader.read(new Uint8Array(buffer, offset, fileSize - offset));
      return value;
    };

    while (offset < fileSize && (chunk = await nextChunk())) {
      buffer = chunk.buffer;
      offset += chunk.byteLength;

      hook(buffer, offset);

      while (pendingSegments[0]) {
        const segment = pendingSegments[0];
        if (segment.byteOffset + segment.byteLength > offset) break;

        const data = new Uint8Array(buffer, segment.byteOffset, segment.byteLength);

        segment.callback(data);
        pendingSegments.shift();

        await Promise.resolve();
      }
    }
  }
}

const Utf8D = new TextDecoder("utf-8");
const Utf16D = new TextDecoder("utf-16");

const getLargeOffset = (smallHeader: FunctionHeader) => ((smallHeader.infoOffset << 16) | smallHeader.offset) >>> 0;
