import { HermesFunction, HermesModule, Instruction, parseHermesModule } from "decompiler";
import { Opcode } from "decompiler/opcodes";
import { readArrayBuffer } from "../test/common.ts";
import { formatSizeUnit, mapValues } from "../utils/index.ts";
import { disassemble } from "./disasm.ts";
import { Rope } from "./rope.ts";
import type { ParsedArguments } from "../decompiler/src/instruction.ts"

type OperandsQuery<Op extends Opcode> = ParsedArguments<Op> extends infer ParsedArgs extends any[] ? {
    [Index in keyof ParsedArgs]: ParsedArgs[Index] | typeof Any;
} : never;
type InstructionQuery<Op extends Opcode = Opcode> = Op extends unknown ? [Op, ...OperandsQuery<Op>] : never;

type a = InstructionQuery<Opcode.GetById>;
//   ^?

const Any = Symbol();

function matchInstruction<Op extends Opcode>(instr: Instruction, query: InstructionQuery<Op>) {
    if (query[0] !== instr.opcode) return false;

    let i = 0;
    for (const arg of instr.operands()) {
        if (typeof query[i] === "number" && arg !== query[i]) {
            return false;
        }

        i++;
    }

    return true;
}

class MatchedInstruction<Q extends InstructionQuery> {
    constructor(instr: Instruction, query: Q) {}
}

class MutableFunction {
    bytecode: Rope<Uint8Array>;

    constructor(public original: HermesFunction) {
        this.bytecode = new Rope(original.bytecode.slice());
    }

    addInstruction(index: number, instr: Uint8Array) {
        this.bytecode = this.bytecode.insert(index, new Rope(instr));
    }

    match(...query: InstructionQuery[]) {
        query = query.map(q => typeof q === "string" ? 0 : q) as any;

        let i = 0;
        let match: MatchedInstruction[] = [];

        for (const instr of this.instructions()) {
            if (matchInstruction(instr, query[i])) {
                match.push(new MatchedInstruction(instr, query));
                i++;
            } else {
                match = [];
                i = 0;
            }

            if (i >= query.length) return match;
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
        patch(f, m) {
            const [get] = f.match([Opcode.PutNewOwnByIdShort, Any, Any, "get"]);

            console.log(get);
            console.log(disassemble(m, f.original));
        },
    },
];

const buffer = await readArrayBuffer("discord/bundle.hbc");

console.time("parse");
const module = parseHermesModule(buffer);
console.timeEnd("parse");

console.time("patch");
patchModule(module);
console.timeEnd("patch");

console.log(mapValues(process.memoryUsage(), formatSizeUnit));

function patchModule(module: HermesModule) {
    class Patch {
        applied?: boolean;
        stringIds: number[] = [];

        constructor(public definition: PatchDefinition) {}
    }

    const Patches: Patch[] = [];

    const strings = module.strings.slice();
    strings.sort((a, b) => a.contents.length - b.contents.length);

    for (const def of patches) {
        const patch = new Patch(def);

        for (const str of def.strings) {
            const id = strings.find(v => v.contents.includes(str))?.id;

            if (id == null) throw Error(`String ${JSON.stringify(str)} couldn't be found`);

            patch.stringIds.push(id);
        }

        Patches.push(patch);
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

        for (const patch of Patches) {
            if (patch.stringIds.every(id => functionStrings.has(id))) {
                patch.definition.patch(new MutableFunction(func), module);
                patch.applied = true;
            }
        }
    });

    console.log(`Scanned ${totalInstrs} instructions`);
    console.log(`${Patches.filter(p => p.applied).length} / ${Patches.length} patches applied`);
}
