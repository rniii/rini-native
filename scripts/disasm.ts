import { parseHermesModule } from "decompiler";
import { disassemble } from "../src/disasm.ts";
import { readArrayBuffer } from "../test/common.ts";
import { instrument } from "../test/profiling.ts";
import { createWriteStream } from "fs";

const disasm = instrument("disassemble", disassemble);

const buffer = await readArrayBuffer(process.argv[2] ?? "discord/bundle.hbc");
const module = parseHermesModule(buffer);

const stream = createWriteStream(process.argv[3] ?? "bytecode.ansi");

let max = 0;

for (let i = 0; i < module.functions.length; i++) {
    process.stdout.write(`${i} / ${module.functions.length}\r`);

    const asm = disasm(module, module.functions[i]);
    max = Math.max(asm.length,max)
    stream.write(asm);
}
