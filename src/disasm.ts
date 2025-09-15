import { HermesFunction, HermesModule } from "decompiler";
import { ArgType, Builtin, Opcode, opcodeTypes } from "decompiler/opcodes";
import { Color as C, drawGutter } from "./formatting.ts";

// this is (still) bad
export function disassemble(module: HermesModule, func: HermesFunction) {
    const header = func.header;

    const name = module.strings[header.functionName].contents || "(anonymous)";
    const addr = `${C.Green}@0x${formatHex(header.offset)}`;

    let src = `#${func.id} ${C.Cyan}${name}${addr}${C.Reset}():\n`;

    const addr2line: number[] = [];
    const jumps = new Map<number, number>();

    func.instructions().forEach((instr, i) => {
        addr2line[instr.ip] = i;

        const types = opcodeTypes[instr.opcode];
        const addrArg = types.findIndex(t => t === ArgType.Addr8 || t === ArgType.Addr32);

        if (addrArg >= 0) jumps.set(instr.ip, instr.ip + instr.getOperand(addrArg));
    });

    const instrCount = (addr2line.at(-1) ?? 0) + 1;

    const pointers = Array.from(jumps, ([from, to]) => ({ from: addr2line[from], to: addr2line[to] }));
    const gutter = drawGutter(instrCount, pointers, { colors: true, curved: true });

    func.instructions().forEach((instr, i) => {
        const name = Opcode[instr.opcode];
        const types = opcodeTypes[instr.opcode];

        let note = "";
        let line = `${C.Purple}${name}${C.Reset}`;

        instr.operands().forEach((value, arg) => {
            const type = types[arg];
            if (arg > 0) line += `,`;

            switch (type) {
                case ArgType.Reg8:
                case ArgType.Reg32:
                    line += ` r${value}`;
                    break;
                case ArgType.Addr8:
                case ArgType.Addr32:
                    const addr = instr.ip + value;
                    line += ` 0x${addr.toString(16).padStart(8, "0")}`;
                    note += ` rel=${value >= 0 ? "+" + value : value}`;
                    break;
                default:
                    if (instr.stringOperands()?.includes(arg)) {
                        line += ` ${JSON.stringify(module.strings[value].contents)}`;
                        note += ` str=#${value}`;
                        break;
                    }
                    if (instr.functionOperands()?.includes(arg)) {
                        const { header } = module.functions[value];

                        line += ` ${module.strings[header.functionName].contents || "(anonymous)"}`;
                        note += ` func=#${value} [0x${formatHex(header.offset)}]`;
                        break;
                    }
                    if (instr.bigintOperands()?.includes(arg)) {
                        line += ` ${module.bigInts[value]}n`;
                        break;
                    }
                    if (
                        (instr.opcode === Opcode.CallBuiltin || instr.opcode === Opcode.CallBuiltinLong)
                        && arg === 1
                    ) {
                        line += ` ${Builtin[value]}`;
                        note += ` builtin=#${value}`;
                        break;
                    }
                    line += ` ${value}`;
                    break;
            }
        });

        if (instr.opcode === Opcode.CreateEnvironment) note += ` envSize=${header.environmentSize}`;

        if (note) line = line.padEnd(50) + `  ${C.Cyan};${note}`;

        src += `${formatHex(instr.ip)} ${gutter[i]} ${line}${C.Reset}\n`;
    });

    return src;
}

function formatHex(value: number, bytes = 4) {
    return value.toString(16).padStart(bytes * 2, "0");
}
