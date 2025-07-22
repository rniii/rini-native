import { largeFunctionHeader, smallFunctionHeader } from "@/bitfields"
import { parseFile, readFile } from "@/parser"
import { instrument, measureProfile } from "./profiling"
import { open } from "node:fs/promises"

smallFunctionHeader.parse = instrument("smallFunctionHeader", smallFunctionHeader.parse.bind(smallFunctionHeader));
largeFunctionHeader.parse = instrument("largeFunctionHeader", largeFunctionHeader.parse.bind(largeFunctionHeader));

await using profile = await measureProfile('./test/profile.cpuprofile')

const bundleHandle = await open("./test/index.android.bundle");
const file = await readFile(bundleHandle)
const parsed = parseFile(file)

const strings = await parsed.stringStorage
console.time('fnHeaders')
const fnHeaders = await parsed.functionHeaders
console.timeEnd('fnHeaders')
