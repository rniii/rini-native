import { encodeInstructions, parseHermesModule } from "decompiler";
import { Opcode, opcodeTypes } from "decompiler/opcodes";
import {
    HermesFunction,
    HermesModule,
    HermesString,
    Instruction,
    type ParsedArguments,
    type PartialFunctionHeader,
} from "decompiler/types";
import type { RawInstruction } from "../decompiler/src/instruction.ts";
import { readArrayBuffer } from "../test/common.ts";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
import { disassemble } from "./disasm.ts";
import { Rope } from "./rope.ts";

type OperandsQuery<Op extends Opcode> = ParsedArguments<Op> extends infer ParsedArgs extends readonly any[] ? {
        [Index in keyof ParsedArgs]: ParsedArgs[Index] | null;
    }
    : never;
type RawOperandsQuery = (number | null)[];
type InstructionQuery<Op extends Opcode = Opcode> = Op extends unknown ? [Op, ...OperandsQuery<Op>] : never;

type ContiguousMatch<Q extends InstructionQuery[]> = {
    [Index in keyof Q]: MatchedInstruction<Q[Index][0]>;
};

class MatchedInstruction<Op extends Opcode> {
    ip: number;
    opcode: Op;
    args: { -readonly [P in keyof ParsedArguments<Op>]: number };

    constructor(instr: Instruction) {
        this.ip = instr.ip;
        this.opcode = instr.opcode as Op;
        this.args = new Proxy(Array(opcodeTypes[instr.opcode].length), {
            get(target, p: string) {
                if (p === "length") return target[p];
                instr.getOperand(+p);
            },
            set(target, p: string, value) {
                if (p === "length") return target[p] = value, true;
                return instr.setOperand(+p, value), true;
            },
        }) as any;
    }
}

interface PatchDefinition {
    strings: string[];
    opcodes?: Opcode[];
    patch(f: MutableBytecode, m: Patcher): void;
}

class Patcher {
    sortedStrings: HermesString[];

    constructor(public module: HermesModule, public patchDefs: PatchDefinition[]) {
        this.sortedStrings = module.strings.slice();
        this.sortedStrings.sort((a, b) => a.contents.length - b.contents.length);
    }

    applyPatches() {
        class Patch {
            applied?: boolean;
            stringIds: number[] = [];

            constructor(public definition: PatchDefinition) {}
        }

        const patches: Patch[] = [];

        const strings = module.strings.slice();
        strings.sort((a, b) => a.contents.length - b.contents.length);

        for (const def of this.patchDefs) {
            const patch = new Patch(def);

            for (const str of def.strings) {
                const id = this.searchString(str);

                if (id < 0) throw Error(`String ${JSON.stringify(str)} couldn't be found`);

                patch.stringIds.push(id);
            }

            patches.push(patch);
        }

        let totalInstrs = 0;
        module.functions.forEach(func => {
            const functionStrings = new Set<number>();
            const functionCallees = new Set<number>();

            for (const instr of func.instructions()) {
                instr.stringOperands()?.forEach(op => functionStrings.add(instr.getOperand(op)));
                instr.functionOperands()?.forEach(op => functionCallees.add(instr.getOperand(op)));

                totalInstrs++;
            }

            for (const patch of patches) {
                if (patch.stringIds.every(id => functionStrings.has(id))) {
                    const code = new MutableBytecode(this, func);

                    patch.definition.patch(code, this);
                    patch.applied = true;

                    console.log(disassemble(module, func, code));
                }
            }
        });

        console.log(`Scanned ${totalInstrs} instructions`);
        console.log(`${patches.filter(p => p.applied).length} / ${patches.length} patches applied`);
    }

    createFunction(options: {
        paramCount: number;
        bytecode: Uint8Array;
    }) {
        const id = this.module.functions.length;
        const header: PartialFunctionHeader = {
            offset: 0,
            paramCount: options.paramCount,
            functionName: this.sortedStrings[0].id,
        };

        this.module.functions.push(new HermesFunction(id, header, options.bytecode));

        return id;
    }

    searchString(str: string) {
        return this.sortedStrings.find(v => v.contents.includes(str))?.id ?? -1;
    }
}

class MutableBytecode {
    bytecode: Rope<Uint8Array>;

    constructor(public patcher: Patcher, func: HermesFunction) {
        this.bytecode = new Rope(func.bytecode.slice());
    }

    addInstruction(index: number, instr: Uint8Array) {
        this.bytecode = this.bytecode.insert(index, new Rope(instr));
    }

    match<const Q extends InstructionQuery[]>(...queries: Q): ContiguousMatch<Q> {
        const normalisedQuery = queries.map(q => (
            q.map(value => {
                if (typeof value === "string") return this.patcher.searchString(value);
                if (typeof value === "bigint") throw "todo";

                return value;
            })
        ));

        const matches = (instr: Instruction, query: RawOperandsQuery) => {
            return query[0] === instr.opcode
                && instr.operands().every((arg, i) => query[i + 1] === null || arg === query[i + 1]);
        };

        let i = 0;
        let match: MatchedInstruction<any>[] = [];

        for (const instr of this.instructions()) {
            if (matches(instr, normalisedQuery[i])) {
                match.push(new MatchedInstruction(instr));
                i++;
            } else {
                match = [];
                i = 0;
            }

            if (i >= queries.length) return match as ContiguousMatch<Q>;
        }

        throw Error("Match failed");
    }

    *instructions() {
        for (const leaf of this.bytecode.leaves()) {
            const view = new DataView(leaf.buffer, leaf.byteOffset, leaf.byteLength);

            let ip = 0;
            while (ip < leaf.byteLength) {
                const instr = new Instruction(ip, view);
                ip += instr.width;

                yield instr;
            }
        }
    }
}

const buffer = await readArrayBuffer("discord/bundle.hbc");

console.time("parse");
const module = parseHermesModule(buffer);
console.timeEnd("parse");

console.time("patch");
const patcher = new Patcher(module, [
    {
        strings: ["Object", "defineProperties", "isDeveloper"],
        patch(f) {
            const [createClosure] = f.match(
                [Opcode.CreateClosureLongIndex, null, null, null],
                [Opcode.PutNewOwnByIdShort, null, null, "get"],
            );

            createClosure.args[2] = gadgets.returnConstTrue;
        },
    },
]);

const gadgets = mapValues(
    {
        returnConstTrue: [[Opcode.LoadConstTrue, 0], [Opcode.Ret, 0]],
        returnConstFalse: [[Opcode.LoadConstFalse, 0], [Opcode.Ret, 0]],
        returnConstZero: [[Opcode.LoadConstZero, 0], [Opcode.Ret, 0]],
        returnConstUndefined: [[Opcode.LoadConstUndefined, 0], [Opcode.Ret, 0]],
        returnConstNull: [[Opcode.LoadConstNull, 0], [Opcode.Ret, 0]],
    } satisfies Record<string, RawInstruction[]>,
    code =>
        patcher.createFunction({
            paramCount: 0,
            bytecode: encodeInstructions(code),
        }),
);

patcher.applyPatches();
console.timeEnd("patch");

console.log(mapValues(process.memoryUsage(), formatSizeUnit));
