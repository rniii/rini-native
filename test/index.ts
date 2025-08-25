import { deepStrictEqual } from "node:assert";
import { open } from "node:fs/promises";
import { parseFile, readFile } from "../src/parser.ts";
import { measureProfile } from "./profiling.ts";

// smallFunctionHeader.parse = instrument("smFunc", smallFunctionHeader.parse.bind(smallFunctionHeader));
// largeFunctionHeader.parse = instrument("lgFunc", largeFunctionHeader.parse.bind(largeFunctionHeader));

await using profile = await measureProfile("./test/profile.cpuprofile");

const bundleHandle = await open("./test/index.android.bundle");

// console.table(await readHeader(bundleHandle))

const file = await readFile(bundleHandle);
const parsed = parseFile(file);

console.time("strings");
const strings = await parsed.stringStorage;
console.timeEnd("strings");

console.time("functions");
const fnHeaders = await parsed.functionHeaders;
console.timeEnd("functions");

deepStrictEqual(fnHeaders[9], {
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
