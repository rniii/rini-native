import { largeFunctionHeader, smallFunctionHeader } from "../src/bitfields";
import { parseFile, readFile, readHeader } from "../src/parser";
import { open } from "node:fs/promises";
import { instrument, measureProfile } from "./profiling";

smallFunctionHeader.parse = instrument("smallFunctionHeader", smallFunctionHeader.parse.bind(smallFunctionHeader));
largeFunctionHeader.parse = instrument("largeFunctionHeader", largeFunctionHeader.parse.bind(largeFunctionHeader));

await using profile = await measureProfile("./test/profile.cpuprofile");

const bundleHandle = await open("./test/index.android.bundle");

console.table(await readHeader(bundleHandle))

const file = await readFile(bundleHandle);
const parsed = parseFile(file);

const strings = await parsed.stringStorage;
console.time("fnHeaders");
const fnHeaders = await parsed.functionHeaders;
console.timeEnd("fnHeaders");
