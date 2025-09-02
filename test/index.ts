import { parseModule } from "decompiler";
import { deepStrictEqual } from "node:assert";
import { open } from "node:fs/promises";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
// import { measureProfile } from "./profiling.ts";

// await using profile = await measureProfile("./test/profile.cpuprofile");

await using bundle = await open("./test/index.android.bundle");
const { size } = await bundle.stat();
const buffer = new ArrayBuffer(size);
await bundle.read(new Uint8Array(buffer));

console.time("parse");
const hermes = await parseModule(buffer);
console.timeEnd("parse");

console.log(hermes.header);

console.log(mapValues(process.memoryUsage(), formatSizeUnit));

deepStrictEqual(hermes.functions[9].header, {
  offset: 11019740,
  paramCount: 2,
  bytecodeSizeInBytes: 101,
  functionName: 146767,
  infoOffset: 35623784,
  frameSize: 14,
  environmentSize: 0,
  highestReadCacheIndex: 4,
  highestWriteCacheIndex: 1,
  prohibitInvoke: 2,
  strictMode: 1,
  hasExceptionHandler: 0,
  hasDebugInfo: 1,
  overflowed: 1,
});
