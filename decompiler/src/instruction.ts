import { mapValues } from "../../utils/index.ts";
import {
    ArgType,
    type BigIntOperands,
    bigintOperands,
    type FunctionOperands,
    functionOperands,
    type Opcode,
    opcodeTypes,
    type OperandSet,
    type StringOperands,
    stringOperands,
} from "./opcodes.ts";

const argWidths: Record<ArgType, number> = {
    [ArgType.UInt8]: 1,
    [ArgType.Reg8]: 1,
    [ArgType.Addr8]: 1,
    [ArgType.UInt16]: 2,
    [ArgType.UInt32]: 4,
    [ArgType.Reg32]: 4,
    [ArgType.Imm32]: 4,
    [ArgType.Addr32]: 4,
    [ArgType.Double]: 8,
};

const operandIndexes = mapValues(opcodeTypes, args => {
    let i = 1;
    return args.map(arg => {
        const j = i;
        i += argWidths[arg];
        return j;
    });
});

export const opcodeWidths = mapValues(opcodeTypes, args => (
    args.reduce((acc, arg) => acc + argWidths[arg], 1)
));

export type ParsedInstruction<Op extends Opcode = Opcode> = Op extends unknown
    ? [Op, ...ParsedArguments<Op>]
    : never;

export type ParsedArguments<Op extends Opcode = Opcode> = Op extends unknown
    ? typeof opcodeTypes[Op] extends infer Args extends readonly ArgType[] ? {
        [I in keyof Args]: TypedOperand<Op, I & string> extends infer T
            ? ([T] extends [never] ? number : T)
            : never;
    } : never : never;

export type RawInstruction<Op extends Opcode = Opcode> = Op extends unknown
    ? [Op, ...RawArguments<Op>]
    : never;

export type RawArguments<Op extends Opcode = Opcode> = Op extends unknown
    ? typeof opcodeTypes[Op] extends infer Args
        ? { [I in keyof Args]: number }
        : never
    : never;

type OperandSetLookup<
    Map extends OperandSet,
    Op extends Opcode,
    Index extends string,
    T,
> = Map extends { [K in Op]: readonly (infer Indices extends number)[] }
    ? Index extends `${Indices}` ? T : never
    : never;

type TypedOperand<Op extends Opcode, Index extends string> =
    | OperandSetLookup<StringOperands, Op, Index, string>
    | OperandSetLookup<BigIntOperands, Op, Index, bigint>
    | OperandSetLookup<FunctionOperands, Op, Index, number>;

export function isValidOpcode(opcode: number): opcode is Opcode {
    return opcode in opcodeTypes;
}

export class Instruction {
    opcode: Opcode;
    width: number;

    constructor(public ip: number, public view: DataView) {
        this.opcode = view.getUint8(ip);
        this.width = opcodeWidths[this.opcode];
    }

    getOperand(idx: number): number {
        const type = opcodeTypes[this.opcode][idx];
        const offset = operandIndexes[this.opcode][idx];

        return this._getValue(type, offset);
    }

    setOperand(idx: number, value: number) {
        const type = opcodeTypes[this.opcode][idx];
        const offset = operandIndexes[this.opcode][idx];

        this._setValue(type, offset, value);
    }

    *operands() {
        const types = opcodeTypes[this.opcode];

        let offset = 1;
        for (const type of types) {
            yield this._getValue(type, offset);
            offset += argWidths[type];
        }
    }

    functionOperands() {
        return functionOperands[this.opcode];
    }

    bigintOperands() {
        return bigintOperands[this.opcode];
    }

    stringOperands() {
        return stringOperands[this.opcode];
    }

    _getValue(type: ArgType, offset: number) {
        switch (type) {
            case ArgType.UInt8:
            case ArgType.Reg8:
                return this.view.getUint8(this.ip + offset);
            case ArgType.Addr8:
                return this.view.getInt8(this.ip + offset);
            case ArgType.UInt16:
                return this.view.getUint16(this.ip + offset, true);
            case ArgType.UInt32:
            case ArgType.Reg32:
                return this.view.getUint32(this.ip + offset, true);
            case ArgType.Imm32:
            case ArgType.Addr32:
                return this.view.getInt32(this.ip + offset, true);
            case ArgType.Double:
                return this.view.getFloat64(this.ip + offset, true);
        }
    }

    _setValue(type: ArgType, offset: number, value: number) {
        switch (type) {
            case ArgType.UInt8:
            case ArgType.Reg8:
                assertRange(value, 0, 2 ** 8);
                return this.view.setUint8(this.ip + offset, value);
            case ArgType.Addr8:
                assertRange(value, -(2 ** 7), +(2 ** 7));
                return this.view.setInt8(this.ip + offset, value);
            case ArgType.UInt16:
                assertRange(value, 0, 2 ** 16);
                return this.view.setUint16(this.ip + offset, value, true);
            case ArgType.UInt32:
            case ArgType.Reg32:
                assertRange(value, 0, 2 ** 32);
                return this.view.setUint32(this.ip + offset, value, true);
            case ArgType.Imm32:
            case ArgType.Addr32:
                assertRange(value, -(2 ** 31), +(2 ** 31));
                return this.view.setInt32(this.ip + offset, value, true);
            case ArgType.Double:
                return this.view.setFloat64(this.ip + offset, value, true);
        }
    }
}

function assertRange(value: number, min: number, max: number) {
    if (value < min || value >= max) throw RangeError(`Value ${value} not in range [${min}, ${max})`);
}

export function encodeInstructions(instructions: RawInstruction[]) {
    const size = instructions.reduce((acc, [op]) => acc + opcodeWidths[op], 0);

    const bytecode = new Uint8Array(size);
    const view = new DataView(bytecode.buffer);

    let ip = 0;
    for (const value of instructions) {
        bytecode[ip] = value[0];
        const instr = new Instruction(ip, view);
        value.slice(1).forEach((arg, i) => instr.setOperand(i, arg));

        ip += instr.width;
    }

    return bytecode;
}
