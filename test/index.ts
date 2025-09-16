import { parseHermesModule } from "decompiler";
import { disassemble } from "../src/disasm.ts";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
import { readArrayBuffer } from "./common.ts";
import { measureProfile } from "./profiling.ts";

await using profile = await measureProfile("./test/profile.cpuprofile");
void profile;

const buffer = await readArrayBuffer("./discord/bundle.hbc");

const startTime = performance.now();
const module = parseHermesModule(buffer);

let iters = 0;
// for (const func of module.functions) {
//     for (const instr of func.instructions()) {
//         for (const arg of instr.operands()) {
//             void arg;
//             iters++;
//         }
//     }
// }

const shortestFuncs = new Map(
    module.functions
        .sort((a, b) => a.header.bytecodeSizeInBytes - b.header.bytecodeSizeInBytes)
        .map(f => [f.header.offset, f] as const)
        .slice(0, 1024),
);

shortestFuncs.forEach(f => console.log(disassemble(module, f)));

const duration = performance.now() - startTime;

console.log(
    `${iters.toLocaleString("fr")} values / ${module.functions.length.toLocaleString("fr")} funcs in ${duration}ms`,
);
console.log(mapValues(process.memoryUsage(), formatSizeUnit));

// console.log(inspect(hermes, { colors: true, depth: 1/0, maxArrayLength: 1 }));
