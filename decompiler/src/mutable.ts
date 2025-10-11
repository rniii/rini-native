import { ModuleBytecode, ModuleFunction } from "./function.ts";
import { Instruction } from "./instruction.ts";
import type { HermesModule } from "./module.ts";
import { Rope } from "./rope.ts";

export class ModulePatcher {
    dirtyFunctions = new Map<number, MutableFunction>();

    constructor(public module: HermesModule) {}

    getMutable(id: number): MutableFunction {
        return this.dirtyFunctions.get(id)
            ?? new MutableFunction(this, this.module.functions[id]);
    }

    _setDirty(func: MutableFunction) {
        this.dirtyFunctions.set(func.inner.id, func);
    }

    modifyFunctions() {
        for (const func of this.dirtyFunctions.values()) {
            const bytes = new Uint8Array(func.bytecode.length);

            let offset = 0;
            for (const leaf of func.bytecode.leaves()) {
                bytes.set(leaf, offset);
                offset += leaf.byteLength;
            };

            const bytecode = new ModuleBytecode(bytes, func.inner.bytecode.jumpTables);

            func.inner.bytecode = bytecode;
            this.module.bytecode.push(bytecode);
        }
    }
}

export class MutableFunction {
    bytecode: Rope<Uint8Array>;

    constructor(public patcher: ModulePatcher, public inner: ModuleFunction) {
        this.bytecode = Rope.from(inner.bytecode.bytes);
    }

    replace(start: number, end: number, bytes: Uint8Array) {
        this.bytecode = this.bytecode.replace(start, end, Rope.from(bytes));
        this.patcher._setDirty(this);
    }

    remove(start: number, end: number) {
        this.bytecode = this.bytecode.remove(start, end);
        this.patcher._setDirty(this);
    }

    insert(index: number, bytes: Uint8Array) {
        this.bytecode = this.bytecode.insert(index, Rope.from(bytes));
        this.patcher._setDirty(this);
    }

    *iterate(start?: number, end?: number) {
        const slice = this.bytecode.slice(start, end);

        for (const leaf of slice.leaves()) {
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
