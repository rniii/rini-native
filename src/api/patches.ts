import { encodeInstructions } from "decompiler";
import type { ModulePatcher, MutableFunction } from "decompiler/mutable";
import { canonicalOpcodes, type FunctionOperands, functionOperands, Opcode, type StringOperands, stringOperands } from "decompiler/opcodes";
import { Instruction, type ParsedArguments, type RawArguments, type RawInstruction } from "decompiler/types";

export interface PatchFingerprint {
    identifier?: string;
    strings?: string[];
    opcodes?: Opcode[];
}

export type PatchAction =
    | { patches: PatchDef | PatchDef[] }
    | { replace: RawInstruction[] }
    | { apply(f: PatchContext): void };

export type PatchDef = PatchFingerprint & PatchAction;

export class PatchContext {
    module: ModulePatcher;

    constructor(public target: MutableFunction) {
        this.module = target.module;
    }

    getClosure(instr: MatchedInstruction<keyof FunctionOperands>) {
        return this.module.getMutable(instr.args[functionOperands[instr.opcode]![0]]);
    }

    getStrings(instr: MatchedInstruction<keyof StringOperands>) {
        return stringOperands[instr.opcode]!.map(op => this.module.original.strings.get(instr.args[op]));
    }

    match<const Q extends InstructionQuery[]>(...query: Q): MatchResults<Q> {
        return this.matchBetween(null, null, query);
    }

    matchAfter<const Q extends InstructionQuery[]>(instr: MatchedInstruction, query: Q): MatchResults<Q> {
        return this.matchBetween(instr, null, query);
    }

    matchBetween<const Q extends InstructionQuery[]>(
        startInstr: MatchedInstruction | null,
        endInstr: MatchedInstruction | null,
        query: Q,
    ): MatchResults<Q> {
        const normalisedQuery = query.map(([op, ...args]) => [canonicalOpcodes[op], ...args.map(value => {
            if (typeof value === "string") {
                const id = this.module.findPartialString(value)?.id;
                if (id == null) throw Error(`Failed to find string ${JSON.stringify(value)}`);

                return id;
            }

            if (typeof value === "bigint") throw "todo";

            return value;
        })]);

        const match: Instruction[] = [];

        for (const instr of this.target.iterate(
            startInstr?.ip,
            endInstr ? endInstr.ip + endInstr.width : void 0,
        )) {
            if (matches(instr, normalisedQuery[match.length])) {
                match.push(instr);
            } else {
                match.length = 0;
            }

            if (match.length >= query.length) {
                return match.map(instr => new MatchedInstruction(instr)) as any;
            }
        }

        throw Error("Match failed");

        function matches(instr: Instruction, query: (number | null)[]) {
            if (query[0] !== instr.opcode && query[0] !== canonicalOpcodes[instr.opcode]) return false;

            return instr.operands().every((arg, i) => query[i + 1] === null || arg === query[i + 1]);
        }
    }

    replaceOne(instr: MatchedInstruction, newInstrs: RawInstruction[]) {
        this.target.replace(instr.ip, instr.ip + instr.width, encodeInstructions(newInstrs));
    }

    replaceRange(startInstr: MatchedInstruction, endInstr: MatchedInstruction, newInstrs: RawInstruction[]) {
        if (startInstr.ip > endInstr.ip) return;

        this.target.replace(startInstr.ip, endInstr.ip + endInstr.width, encodeInstructions(newInstrs));
    }

    replace(newInstrs: RawInstruction[]) {
        this.target.replace(0, this.target.bytecode.length, encodeInstructions(newInstrs));
    }

    insertAfter(instr: MatchedInstruction, newInstrs: RawInstruction[]) {
        this.target.insert(instr.ip + instr.width, encodeInstructions(newInstrs));
    }

    insertBefore(instr: MatchedInstruction, newInstrs: RawInstruction[]) {
        this.target.insert(instr.ip, encodeInstructions(newInstrs));
    }
}

type OperandsQuery<Op extends Opcode> =
    ParsedArguments<Op> extends infer ParsedArgs extends ReadonlyArray<any>
        ? { [Index in keyof ParsedArgs]: ParsedArgs[Index] | null }
        : never;

type InstructionQuery<Op extends Opcode = Opcode> =
    Op extends unknown ? [Op, ...OperandsQuery<Op>] : never;

type MatchResults<Q extends InstructionQuery[]> = {
    [Index in keyof Q]: MatchedInstruction<Q[Index][0]>;
};

class MatchedInstruction<Op extends Opcode = Opcode> {
    ip: number;
    opcode: Op;
    args: RawArguments<Op>;
    width: number;

    constructor(instr: Instruction) {
        this.ip = instr.ip;
        this.opcode = instr.opcode as Op;
        this.args = [...instr.operands()] as any;
        this.width = instr.width;
    }
}
