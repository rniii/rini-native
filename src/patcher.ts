import { parseHermesModule } from "decompiler";
import { Opcode } from "decompiler/opcodes";
import { HermesFunction, HermesModule, HermesString, Instruction, type ParsedArguments } from "decompiler/types";
import { readArrayBuffer } from "../test/common.ts";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
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

class MatchedInstruction<Op extends Opcode = Opcode> {
    ip: number;
    opcode: Op;
    operands: number[];

    constructor(instr: Instruction, query: InstructionQuery<Op>) {
        this.ip = instr.ip;
        this.opcode = instr.opcode as Op;
        this.operands = [...instr.operands()];
    }
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
                    patch.definition.patch(new MutableFunction(this, func), module);
                    patch.applied = true;
                }
            }
        });

        console.log(`Scanned ${totalInstrs} instructions`);
        console.log(`${patches.filter(p => p.applied).length} / ${patches.length} patches applied`);
    }

    searchString(str: string) {
        return this.sortedStrings.find(v => v.contents.includes(str))?.id ?? -1;
    }
}

class MutableFunction {
    bytecode: Rope<Uint8Array>;

    constructor(public patcher: Patcher, public inner: HermesFunction) {
        this.bytecode = new Rope(inner.bytecode.slice());
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
                && instr.operands().every((arg, i) => typeof query[i + 1] === null || arg === query[i + 1]);
        };

        let i = 0;
        let match: MatchedInstruction[] = [];

        for (const instr of this.instructions()) {
            if (matches(instr, normalisedQuery[i])) {
                match.push(new MatchedInstruction(instr, queries[i]));
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

interface PatchDefinition {
    strings: string[];
    opcodes?: Opcode[];
    patch(f: MutableFunction, m: HermesModule): void;
}

const patches: PatchDefinition[] = [
    {
        strings: ["Object", "defineProperties", "isDeveloper"],
        patch(f) {
            const [createClosure] = f.match(
                [Opcode.CreateClosureLongIndex, null, null, null],
                [Opcode.PutNewOwnByIdShort, null, null, "get"],
            );

            console.log(createClosure);
        },
    },
];

const buffer = await readArrayBuffer("discord/bundle.hbc");

console.time("parse");
const module = parseHermesModule(buffer);
console.timeEnd("parse");

console.time("patch");
const patcher = new Patcher(module, patches);
patcher.applyPatches();
console.timeEnd("patch");

console.log(mapValues(process.memoryUsage(), formatSizeUnit));
