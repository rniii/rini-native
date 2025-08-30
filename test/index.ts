import { createStreamReader, parseModule } from "decompiler";
import { deepStrictEqual } from "node:assert";
import { open } from "node:fs/promises";
// import { measureProfile } from "./profiling.ts";

// await using profile = await measureProfile("./test/profile.cpuprofile");

const bundleHandle = await open("./test/index.android.bundle");
const { size } = await bundleHandle.stat();

const { reader } = createStreamReader(bundleHandle.readableWebStream() as any, size);

console.time("parse");
const hermes = await parseModule(reader);
console.timeEnd("parse");

console.log(hermes.header)

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
  overflowed: 0,
});
