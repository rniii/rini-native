import { parseHermesModule } from "decompiler";
import { inspect } from "node:util";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
import { readArrayBuffer } from "./common.ts";
// import { measureProfile } from "./profiling.ts";

// await using profile = await measureProfile("./test/profile.cpuprofile");

const buffer = await readArrayBuffer("./discord/bundle.hbc");

const startTime = performance.now();
const hermes = parseHermesModule(buffer);
const duration = performance.now() - startTime;

console.log(`${hermes.functions.length.toLocaleString("fr")} funcs in ${duration}ms`);
console.log(mapValues(process.memoryUsage(), formatSizeUnit));

console.log(inspect(hermes, { colors: true, depth: 1/0, maxArrayLength: 1 }));
