import { HermesFunction, HermesModule } from "decompiler";
import { ArgType, Builtin, Opcode, opcodeTypes } from "decompiler/opcodes";
import { Color as C, drawGutter } from "./formatting.ts";

// this is (still) bad
export function disassemble(module: HermesModule, func: HermesFunction, index: number) {
    const header = func.header;

    const name = module.strings[header.functionName].contents || "(anonymous)";
    const addr = "0x" + formatHex(header.offset);
    const mangled = `${C.Cyan}#${index}: ${name}${C.Green}@${addr}${C.Reset}`;
    const params = Array.from(Array(header.paramCount), (_, i) => `p${i}`).join(", ");

    let lines: string[] = [];
    const addresses: number[] = [];
    const addr2line: number[] = [];
    const jumps = new Map<number, number>();

    for (const instr of func.instructions()) {
        const ip = instr.ip;
        const name = Opcode[instr.opcode];
        const types = opcodeTypes[instr.opcode];

        addresses.push(ip);
        addr2line[ip] = lines.length;

        let src = "";
        let ann = "";

        src += `${C.Purple}${name}${C.Reset}`;

        instr.operands().forEach((value, arg) => {
            const type = types[arg];
            if (arg > 0) src += `,`;

            switch (type) {
                case ArgType.Reg8:
                case ArgType.Reg32:
                    src += ` r${value}`;
                    break;
                case ArgType.Addr8:
                case ArgType.Addr32:
                    const addr = ip + value;
                    src += ` 0x${addr.toString(16).padStart(8, "0")}`;
                    ann += ` rel=${value >= 0 ? "+" + value : value}`;
                    jumps.set(ip, addr);
                    break;
                default:
                    if (instr.stringOperands()?.includes(arg)) {
                        src += ` ${JSON.stringify(module.strings[value].contents)}`;
                        ann += ` str=#${value}`;
                        break;
                    }
                    if (instr.functionOperands()?.includes(arg)) {
                        const { header } = module.functions[value];

                        src += ` ${module.strings[header.functionName].contents || "(anonymous)"}`;
                        ann += ` func=#${value} [0x${formatHex(header.offset)}]`;
                        break;
                    }
                    if (instr.bigIntOperands()?.includes(arg)) {
                        src += ` ${module.bigInts[value]}n`;
                        break;
                    }
                    if (
                        (instr.opcode === Opcode.CallBuiltin || instr.opcode === Opcode.CallBuiltinLong)
                        && arg === 1
                    ) {
                        src += ` ${Builtin[value]}`;
                        ann += ` builtin=#${value}`;
                        break;
                    }
                    src += ` ${value}`;
                    break;
            }
        });

        if (instr.opcode === Opcode.CreateEnvironment) ann += ` envSize=${header.environmentSize}`;

        if (ann) src = src.padEnd(52) + ` ${C.Cyan};${ann}`;

        src += C.Reset;

        lines.push(src);
    }

    const pointers = Array.from(jumps, ([from, to]) => ({ from: addr2line[from], to: addr2line[to] }));
    const gutter = drawGutter(lines.length, pointers, { colors: true, curved: true });

    lines = lines.map((line, i) => `${formatHex(addresses[i])} ${gutter[i]} ${line}`);

    return `${mangled}(${params}):\n${lines.join("\n")}\n`;
}

function formatHex(value: number, bytes = 4) {
    return value.toString(16).padStart(bytes * 2, "0");
}
