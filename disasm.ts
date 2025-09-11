import { type BytecodeFunction, parseModule } from "decompiler";
import { bigIntOperands, Builtin, functionOperands, Opcode, opcodeTypes, stringOperands } from "decompiler/opcodes";
import { appendFile, open, writeFile } from "fs/promises";
import { CYAN, drawGutter, GREEN, PURPLE, RESET } from "./src/formatting.ts";
import { instrument } from "./test/profiling.ts";

await using bundle = await open(process.argv[2] ?? "discord/bundle.hbc");

const { size } = await bundle.stat();
const buffer = new ArrayBuffer(size);
await bundle.read(new Uint8Array(buffer));
await bundle.close();

const hermes = parseModule(buffer);

await writeFile("bytecode.ansi", "");

const disassemble = instrument("disassemble", disassemble_);

for (let i = 0; i < hermes.functions.length; ++i) {
    await appendFile("bytecode.ansi", disassemble(hermes.functions[i], i));
}

// this is bad
function disassemble_({ header, bytecode }: BytecodeFunction, index: number) {
    const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);

    const name = hermes.strings[header.functionName] || "<closure>";
    const addr = "0x" + header.offset.toString(16).padStart(8, "0");
    const mangled = `${CYAN}#${index}: ${name}${GREEN}@${addr}${RESET}`;
    const params = Array.from(Array(header.paramCount), (_, i) => `p${i}`).join(", ");

    let lines: string[] = [];
    const addresses: number[] = [];
    const addr2line: number[] = [];
    const jumpSources: number[] = [];
    const jumpTargets: number[] = [];

    let i = 0;
    while (i < header.bytecodeSizeInBytes) {
        addresses.push(i);
        addr2line[i] = lines.length;

        const ip = i;
        const op = bytecode[i++] as Opcode;
        const name = Opcode[op];
        const types = opcodeTypes[op];

        let src = "";
        let ann = "";

        if (!name) throw Error(`Invalid opcode: ${op}`);

        src += `${PURPLE}${name}${RESET}`;

        for (let j = 0; j < types.length; j++) {
            const arg = types[j];
            if (j > 0) src += `,`;

            const [value, width] = (() => {
                switch (arg) {
                    case "Reg32":
                    case "UInt32":
                    case "Imm32":
                        return [view.getUint32(i, true), 4];
                    case "Addr32":
                        return [view.getInt32(i, true), 4];
                    case "UInt16":
                        return [view.getUint16(i, true), 2];
                    case "Reg8":
                    case "UInt8":
                        return [view.getUint8(i), 1];
                    case "Addr8":
                        return [view.getInt8(i), 1];
                    case "Double":
                        return [view.getFloat64(i, true), 8];
                    default:
                        throw arg satisfies never;
                }
            })();

            if (arg.startsWith("Reg")) {
                src += ` r${value}`;
            } else if (arg.startsWith("Addr")) {
                const addr = ip + value;
                src += ` 0x${addr.toString(16).padStart(8, "0")}`;
                jumpSources[ip] = addr;
                jumpTargets[addr] = ip;
            } else if (stringOperands[op]?.includes(j + 1)) {
                src += ` ${JSON.stringify(hermes.strings[value])}`;
                ann += ` ${value}`;
            } else if (functionOperands[op]?.includes(j + 1)) {
                src += ` ${hermes.strings[hermes.functions[value].header.functionName]}#${value}`;
            } else if (bigIntOperands[op]?.includes(j + 1)) {
                src += ` ${hermes.bigInts[value]}n`;
            } else if ((op === Opcode.CallBuiltin || op === Opcode.CallBuiltinLong) && j == 1) {
                src += ` ${Builtin[value]}`;
            } else {
                src += ` ${value}`;
            }

            i += width;
        }

        if (op === Opcode.CreateEnvironment) ann += ` envSize=${header.environmentSize}`;

        if (ann) src = src.padEnd(52) + ` ${CYAN};${ann}`;

        src += RESET;

        lines.push(src);
    }

    const pointers = jumpSources.map((to, from) => ({ from: addr2line[from], to: addr2line[to] })).filter(n =>
        n != null
    );
    if (pointers.some(({ from, to }) => from == null || to == null)) {
        throw new Error("Cannot draw pointers: some addresses undefined");
    }
    const gutter = drawGutter(lines.length, pointers, { colors: true, curved: true });

    lines = lines.map((line, i) => `${addresses[i].toString(16).padStart(8, "0")} ${gutter[i]} ${line}\n`);

    return `${mangled}(${params}):\n`
        + lines.join("");
}
