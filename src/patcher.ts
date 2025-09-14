import { HermesFunction, HermesModule, parseHermesModule } from "decompiler";
import { readArrayBuffer } from "../test/common.ts";
import { disassemble } from "./disasm.ts";

interface PatchDefinition {
    strings: string[];
    patch(f: HermesFunction, m: HermesModule, i: number): void;
}

const patches: PatchDefinition[] = [
    {
        strings: ["Object", "defineProperties", "isDeveloper"],
        patch(f, m, i) {
            console.log(disassemble(m, f, i));
        },
    },
];

const startTime = performance.now();
const buffer = await readArrayBuffer("discord/bundle.hbc");

patchModule(buffer);

console.log(`Done in ${performance.now() - startTime}ms`);

function patchModule(buffer: ArrayBuffer) {
    class Patch {
        stringIds: number[] = [];

        constructor(public definition: PatchDefinition) {}
    }

    const Patches: Patch[] = [];

    const module = parseHermesModule(buffer);

    const strings = module.strings.slice();
    strings.sort((a, b) => a.contents.length - b.contents.length);

    for (const def of patches) {
        const patch = new Patch(def);

        for (const str of def.strings) {
            const id = strings.find(v => v.contents.includes(str))?.key;

            if (id == null) throw Error(`String ${JSON.stringify(str)} couldn't be found`);

            patch.stringIds.push(id);
        }

        Patches.push(patch);
    }

    let totalInstrs = 0;
    module.functions.forEach((func, id) => {
        const functionStrings = new Set<number>();
        const functionCallees = new Set<number>();

        for (const instr of func.instructions()) {
            instr.stringOperands()?.forEach(op => functionStrings.add(instr.getOperand(op)));
            instr.functionOperands()?.forEach(op => functionCallees.add(instr.getOperand(op)));

            totalInstrs++;
        }

        for (const patch of Patches) {
            if (patch.stringIds.every(id => functionStrings.has(id))) {
                patch.definition.patch(func, module, id);
            }
        }
    });

    console.log(`Iterated through ${totalInstrs} instructions`);
}
