import { type HermesModule, Instruction, parseLiterals } from "decompiler";
import type { MutableFunction } from "decompiler/mutable";
import { ArgType, Builtin, Opcode, opcodeTypes } from "decompiler/opcodes";
import type { Literal, ModuleFunction } from "decompiler/types";

import { Color as C, drawGutter } from "./formatting.ts";

// this is (still) bad
export function disassemble(module: HermesModule, func: ModuleFunction) {
    const header = func.header;
    const bc = func.bytecode.opcodes;

    const name = module.strings.get(header.functionName) || "(anonymous)";
    const addr = `[${formatAddr(bc.byteOffset)}]`;

    let src = `#${func.id} ${C.Cyan}${name} ${C.Green}${addr}${C.Reset}\n`;

    const addr2line: number[] = [];
    const jumps = new Map<number, number>();

    Instruction.iterate(bc).forEach((instr, i) => {
        addr2line[instr.ip] = i;

        const types = opcodeTypes[instr.opcode];
        const addrArg = types.findIndex(t => t === ArgType.Addr8 || t === ArgType.Addr32);

        if (addrArg >= 0) jumps.set(instr.ip, instr.ip + instr.getOperand(addrArg));
    });

    const instrCount = (addr2line.at(-1) ?? 0) + 1;

    const pointers = Array.from(jumps, ([from, to]) => ({ from: addr2line[from], to: addr2line[to] }));
    const gutter = drawGutter(instrCount, pointers, { colors: true, curved: true });

    Instruction.iterate(bc).forEach((instr, i) => {
        try {
            var { name, args, notes } = disassembleInstruction(module, func, instr);
        } catch (error) {
            throw new IllegalInstruction(func, instr, error as any);
        }

        let line = `${C.Purple}${name}${C.Reset} ${args.join(", ")}`;

        if (notes.length) line = line.padEnd(50) + `  ${C.Cyan}; ${notes.join(" ")}`;

        src += `${formatHex(instr.ip)} ${gutter[i]} ${line}${C.Reset}\n`;
    });

    return src;
}

function disassembleInstruction(module: HermesModule, func: ModuleFunction, instr: Instruction) {
    const types = opcodeTypes[instr.opcode];

    const name = Opcode[instr.opcode];
    const notes: string[] = [];

    const args = Array.from(instr.operands(), (value, arg) => {
        const type = types[arg];

        if (type === ArgType.Reg8 || type === ArgType.Reg32) {
            return `r${value}`;
        }
        if (type === ArgType.Addr8 || type === ArgType.Addr32) {
            return formatAddr(instr.ip + value);
        }
        if (builtinOperand[instr.opcode] === arg) {
            return Builtin[value];
        }
        if (instr.stringOperands()?.includes(arg)) {
            notes.push(`str=$${value}`);
            return JSON.stringify(module.strings.get(value));
        }
        if (instr.functionOperands()?.includes(arg)) {
            const { header, bytecode } = module.functions[value];

            notes.push(`func=#${value} [${formatAddr(bytecode.opcodes.byteOffset)}]`);
            return module.strings.get(header.functionName) || "(anonymous)";
        }
        if (instr.bigintOperands()?.includes(arg)) {
            return `${module.bigInts.get(value)}n`;
        }
        return value.toString();
    });

    switch (instr.opcode) {
        case Opcode.CreateEnvironment:
            notes.push(`envSize=${func.header.environmentSize}`);
            break;
        case Opcode.NewArrayWithBuffer:
        case Opcode.NewArrayWithBufferLong: {
            const [,, count, valIdx] = instr.operands();

            const items = parseLiterals(module.arrayBuffer, valIdx, count, module.strings);

            notes.push(`[${items.map(v => JSON.stringify(v)).join(", ")}]`);
            break;
        }
        case Opcode.NewObjectWithBuffer:
        case Opcode.NewObjectWithBufferLong: {
            const [,, count, keyIdx, valIdx] = instr.operands();

            const keys = parseLiterals(module.objectKeyBuffer, keyIdx, count, module.strings);
            const values = parseLiterals(module.objectValueBuffer, valIdx, count, module.strings);

            notes.push(`{ ${keys.map((k, i) => `${formatKey(k)}: ${JSON.stringify(values[i])}`).join(", ")} }`);
            break;
        }
    }

    return { name, args, notes };
}

function formatKey(value: Literal) {
    if (typeof value !== "string") return `[${value}]`;

    return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
}

const builtinOperand: Partial<Record<Opcode, number>> = {
    [Opcode.CallBuiltin]: 1,
    [Opcode.CallBuiltinLong]: 1,
};

function formatAddr(addr: number) {
    return "0x" + formatHex(addr);
}

function formatHex(value: number, bytes = 4) {
    return value.toString(16).padStart(bytes * 2, "0");
}

class IllegalInstruction extends Error {
    override name = "IllegalInstruction";

    constructor(public func: ModuleFunction, public instruction: Instruction, cause?: string | Error) {
        const detail = `${Opcode[instruction.opcode]} ${JSON.stringify([...instruction.operands()])}`;

        super(`Illegal instruction: ${detail}`, { cause });
    }
}
