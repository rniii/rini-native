import { ArgType, Builtin, Opcode, opcodeTypes } from "decompiler/opcodes";
import { type Bytecode, HermesFunction, HermesModule, Instruction } from "decompiler/types";
import { Color as C, drawGutter } from "./formatting.ts";

// this is (still) bad
export function disassemble(module: HermesModule, func: HermesFunction, code = func as Bytecode) {
    const header = func.header;

    const name = module.strings[header.functionName].contents || "(anonymous)";
    const addr = `${C.Green}@${formatAddr(header.offset)}`;

    let src = `#${func.id} ${C.Cyan}${name}${addr}${C.Reset}():\n`;

    const addr2line: number[] = [];
    const jumps = new Map<number, number>();

    code.instructions().forEach((instr, i) => {
        addr2line[instr.ip] = i;

        const types = opcodeTypes[instr.opcode];
        const addrArg = types.findIndex(t => t === ArgType.Addr8 || t === ArgType.Addr32);

        if (addrArg >= 0) jumps.set(instr.ip, instr.ip + instr.getOperand(addrArg));
    });

    const instrCount = (addr2line.at(-1) ?? 0) + 1;

    const pointers = Array.from(jumps, ([from, to]) => ({ from: addr2line[from], to: addr2line[to] }));
    const gutter = drawGutter(instrCount, pointers, { colors: true, curved: true });

    code.instructions().forEach((instr, i) => {
        const { name, args, notes } = disassembleInstruction(module, func, instr);

        let line = `${C.Purple}${name}${C.Reset} ${args.join(", ")}`;

        if (notes.length) line = line.padEnd(50) + `  ${C.Cyan}; ${notes.join(" ")}`;

        src += `${formatHex(instr.ip)} ${gutter[i]} ${line}${C.Reset}\n`;
    });

    return src;
}

function disassembleInstruction(module: HermesModule, func: HermesFunction, instr: Instruction) {
    const types = opcodeTypes[instr.opcode];

    const name = Opcode[instr.opcode];
    const notes: string[] = [];

    const args = Array.from(instr.operands(), (value, arg) => {
        const type = types[arg];

        if (type === ArgType.Reg8 || type === ArgType.Reg32) {
            return `r${value}`;
        }
        if (type === ArgType.Addr8 || type === ArgType.Addr32) {
            notes.push(`rel=${value >= 0 ? "+" : ""}${value}`);
            return formatAddr(instr.ip + value);
        }
        if (instr.stringOperands()?.includes(arg)) {
            notes.push(`str=${value}`);
            return JSON.stringify(module.strings[value].contents);
        }
        if (instr.functionOperands()?.includes(arg)) {
            const { header } = module.functions[value];

            notes.push(`func=#${value} [${header.offset ? formatAddr(header.offset) : "new"}]`);
            return module.strings[header.functionName].contents || "(anonymous)";
        }
        if (instr.bigintOperands()?.includes(arg)) {
            return `${module.bigInts[value]}n`;
        }
        if ([Opcode.CallBuiltin, Opcode.CallBuiltinLong].includes(instr.opcode) && arg === 1) {
            notes.push(`builtin=#${value}`);
            return Builtin[value];
        }
        return value.toString();
    });

    if (instr.opcode === Opcode.CreateEnvironment) notes.push(`envSize=${func.header.environmentSize}`);

    return { name, args, notes };
}

function formatAddr(addr: number) {
    return "0x" + formatHex(addr);
}

function formatHex(value: number, bytes = 4) {
    return value.toString(16).padStart(bytes * 2, "0");
}
