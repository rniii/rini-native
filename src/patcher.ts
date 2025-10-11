import { parseHermesModule, writeHermesModule } from "decompiler";
import { ModulePatcher } from "decompiler/mutable";
import { writeFile } from "fs/promises";

import { readArrayBuffer } from "../test/common.ts";
import { formatSizeUnit, mapValues } from "../utils/index.ts";

const buffer = await readArrayBuffer("discord/bundle.hbc");

const module = timed("parse", () => parseHermesModule(buffer));

timed("patch", () => {
    const patcher = new ModulePatcher(module);
    patcher.modifyFunctions();
});

const patched = timed("write", () => writeHermesModule(module));

await writeFile("./discord/patched.hbc", patched);

console.log(mapValues(process.memoryUsage(), formatSizeUnit));

function timed<T>(label: string, cb: () => T) {
    console.time(label);
    const result = cb();
    console.timeEnd(label);

    return result;
}
