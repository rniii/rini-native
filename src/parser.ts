import { open } from "fs/promises";
import { fromEntries } from "utils";

const bundle = await open("base/assets/index.android.bundle");

const readHeader = async () => {
  const MAGIC = 0x1F1903C103BC1FC6n;

  let i = 0;
  const buffer = Buffer.alloc(128);
  await bundle.read(buffer, 0);

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

const getSegments = () => {
  let i = 128;
  const segment = <T>(sz: number, get: (buf: Buffer) => T) => {
    let j = i;
    i += sz;
    return async () => {
      const buf = Buffer.alloc(sz);
      await bundle.read(buf, 0, sz, j);

      return await get(buf);
    };
  };

  const segments = {};

  return {
    functionHeaders: segment(header.functionCount * 16, buf => {
      const idx = 23572; // random func (hopefully more interesting)
      const header = buf.subarray(idx * 16, idx * 16 + 16);

      return { };
    }),
    stringKinds: segment(header.stringKindCount * 4, () => {}),
    identifierHashes: segment(header.identifierCount * 4, () => {}),
    stringTable: segment(header.stringCount * 12, () => {}),
    overflowStringTable: segment(header.overflowStringCount * 8, () => {}),
    stringStorage: segment(header.stringStorageSize * 1, () => {}),
    arrayBuffer: segment(header.arrayBufferSize * 1, () => {}),
    objectKeyBuffer: segment(header.objKeyBufferSize * 1, () => {}),
    objectValueBuffer: segment(header.objValueBufferSize * 1, () => {}),
    bigIntTable: segment(header.bigIntCount * 8, () => {}),
    bigIntStorage: segment(header.bigIntStorageSize * 1, () => {}),
    regExpTable: segment(header.regExpCount * 8, () => {}),
    regExpStorage: segment(header.regExpStorageSize * 1, () => {}),
    cjsModuleTable: segment(header.cjsModuleCount * 8, () => {}),
    functionSourceTable: segment(header.functionSourceCount * 8, () => {}),
  };
};

const header = await readHeader();

console.table(header);

const segments = getSegments();
console.log(await segments.functionHeaders());
