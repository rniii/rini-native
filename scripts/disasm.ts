import { parseHermesModule } from "decompiler";
import { appendFile, open } from "fs/promises";

import { disassemble } from "../src/disasm.ts";
import { readArrayBuffer } from "../test/common.ts";
import { instrument } from "../test/profiling.ts";

const disasm = instrument("disassemble", disassemble);

const buffer = await readArrayBuffer(process.argv[2] ?? "discord/bundle.hbc");
const module = parseHermesModule(buffer);

const output = await open(process.argv[3] ?? "bytecode.ansi", "w");

for (let i = 0; i < module.functions.length; i++) {
    process.stdout.write(`${i} / ${module.functions.length}\r`);

    await appendFile(output, disasm(module, module.functions[i]));
}
