import { mapValues } from "../../utils/index.ts";
import { ArgType, bigIntOperands, functionOperands, type Opcode, opcodeTypes, stringOperands } from "./opcodes.ts";

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

const opcodeWidths = mapValues(opcodeTypes, args => (
    args.reduce((acc, arg) => acc + argWidths[arg], 1)
));

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

    *operands() {
        const types = opcodeTypes[this.opcode];

        let offset = 1;
        for (const type of types) {
            yield this._getValue(type, offset);
            offset += argWidths[type];
        }
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

    functionOperands(): number[] | undefined {
        return functionOperands[this.opcode];
    }

    bigIntOperands(): number[] | undefined {
        return bigIntOperands[this.opcode];
    }

    stringOperands(): number[] | undefined {
        return stringOperands[this.opcode];
    }
}
