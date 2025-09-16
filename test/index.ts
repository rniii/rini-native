import { parseHermesModule } from "decompiler";
import { writeFile } from "fs/promises";
import { writeHermesModule } from "../decompiler/src/moduleWriter.ts";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
import { readArrayBuffer } from "./common.ts";
import { measureProfile } from "./profiling.ts";

await using profile = await measureProfile("./test/profile.cpuprofile");
void profile;

const buffer = await readArrayBuffer("./discord/bundle.hbc");

console.time("parse");
const module = parseHermesModule(buffer);
console.timeEnd("parse");

console.time("write");
const patched = await writeHermesModule(module);
console.timeEnd("write");

await writeFile("./discord/patched.hbc", patched);

console.log(mapValues(process.memoryUsage(), formatSizeUnit));

// console.log(inspect(hermes, { colors: true, depth: 1/0, maxArrayLength: 1 }));
