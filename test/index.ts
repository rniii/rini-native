import { parseHermesModule } from "decompiler";
import { writeHermesModule } from "../decompiler/src/moduleWriter.ts";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
import { readArrayBuffer } from "./common.ts";
import { measureProfile } from "./profiling.ts";

await using profile = await measureProfile("./test/profile.cpuprofile");
void profile;

const buffer = await readArrayBuffer("./discord/bundle.hbc");
const origHash = new Uint8Array(buffer, buffer.byteLength - 20);

console.time("parse");
const module = parseHermesModule(buffer);
console.timeEnd("parse");

console.time("write");
const patched = writeHermesModule(module);
console.timeEnd("write");

const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", patched.subarray(0, patched.byteLength - 20)));

if (hash.some((x, i) => origHash[i] !== x)) {
    throw Error(`Hash mismatch: ${Array.from(hash, x => x.toString(16).padStart(2, "0")).join("")}`);
}

console.log(mapValues(process.memoryUsage(), formatSizeUnit));
