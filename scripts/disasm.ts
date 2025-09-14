import { parseHermesModule } from "decompiler";
import { appendFile, writeFile } from "fs/promises";
import { disassemble } from "../src/disasm.ts";
import { readArrayBuffer } from "../test/common.ts";
import { instrument } from "../test/profiling.ts";

const disasm = instrument("disassemble", disassemble);

const buffer = await readArrayBuffer(process.argv[2] ?? "discord/bundle.hbc");
const module = parseHermesModule(buffer);

await writeFile("bytecode.ansi", "");

for (let i = 0; i < module.functions.length; i++) {
    process.stdout.write(`${i} / ${module.functions.length}\r`);

    await appendFile("bytecode.ansi", disasm(module, module.functions[i], i));
}
