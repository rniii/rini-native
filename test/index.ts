import { parseModule } from "decompiler";
import { open } from "node:fs/promises";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
// import { measureProfile } from "./profiling.ts";

// await using profile = await measureProfile("./test/profile.cpuprofile");

await using bundle = await open("./discord/bundle.hbc");
const { size } = await bundle.stat();
const buffer = new ArrayBuffer(size);
await bundle.read(new Uint8Array(buffer));

console.time("parse");
const hermes = parseModule(buffer);
console.timeEnd("parse");

console.log(hermes.header);
console.log(mapValues(process.memoryUsage(), formatSizeUnit));
