import { parseHermesModule } from "decompiler";
import { ModulePatcher, MutableFunction } from "decompiler/mutable";
import { Opcode } from "decompiler/opcodes";
import { writeFile } from "fs/promises";

import { writeHermesModule } from "../decompiler/src/moduleWriter.ts";
import { readArrayBuffer } from "../test/common.ts";
import { formatSizeUnit, mapValues } from "../utils/index.ts";

export interface PatchDefinition {
    strings: string[];
    opcodes?: Opcode[];
    patch(f: MutableFunction): void;
}

const buffer = await readArrayBuffer("discord/bundle.hbc");

console.time("parse");
const module = parseHermesModule(buffer);
console.timeEnd("parse");

console.time("patch");
const patchDefs: PatchDefinition[] = [
    {
        strings: ["Object", "defineProperties", "isDeveloper"],
        patch(f) {
            const [createClosure] = f.match(
                [Opcode.CreateClosureLongIndex, null, null, null],
                [Opcode.PutNewOwnByIdShort, null, null, "get"],
            );

            createClosure.args[2] = f.patcher.createFunction([
                [Opcode.LoadConstTrue, 0],
                [Opcode.Ret, 0],
            ], { paramCount: 0 });
        },
    },
];

const patcher = new ModulePatcher(module);

{
    interface Patch extends PatchDefinition {
        applied?: boolean;
        stringIds: number[];
    }

    const patches: Patch[] = [];

    for (const def of patchDefs) {
        const patch = {
            ...def,
            stringIds: def.strings.map(str => patcher.findString(str)),
        } as Patch;

        patches.push(patch);
    }

    let totalInstrs = 0;
    let applied = 0;

    for (let id = 0; id < module.functions.length; id++) {
        const func = module.functions[id];

        const functionStrings = new Set<number>();
        const functionCallees = new Set<number>();

        for (const instr of func.bytecode.instructions()) {
            instr.stringOperands()?.forEach(op => functionStrings.add(instr.getOperand(op)));
            instr.functionOperands()?.forEach(op => functionCallees.add(instr.getOperand(op)));

            totalInstrs++;
        }

        for (const patch of patches) {
            if (patch.stringIds.every(id => functionStrings.has(id))) {
                const code = patcher.getMutable(id);

                patch.patch(code);
                if (patch.applied) {
                    console.warn("Fingerprint is not unique enough");
                } else {
                    patch.applied = true;
                    applied++;
                }
            }
        }

        if (applied === patches.length) break;
    }

    console.log(`Scanned ${totalInstrs} instructions`);
    console.log(`${applied} / ${patches.length} patches applied`);
}

patcher.modifyFunctions();
console.timeEnd("patch");

console.time("write");
const patched = writeHermesModule(module);
console.timeEnd("write");

await writeFile("./discord/patched.hbc", patched);

console.log(mapValues(process.memoryUsage(), formatSizeUnit));
