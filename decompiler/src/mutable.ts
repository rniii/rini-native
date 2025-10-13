import { bisect } from "../../utils/index.ts";
import { type StringTableEntry, stringTableEntry } from "./bitfields.ts";
import { ModuleBytecode, ModuleFunction } from "./function.ts";
import { Instruction } from "./instruction.ts";
import type { HermesModule, UniqueString } from "./module.ts";
import { Rope } from "./rope.ts";

const Utf8E = new TextEncoder();

export class ModulePatcher {
    dirtyFunctions: Map<number, MutableFunction>;

    /** Sorted array of buckets of strings with the same length */
    stringIndex: UniqueString[][];
    newStrStorage: Rope<Uint8Array>;
    newStrEntries: StringTableEntry[];

    constructor(public module: HermesModule) {
        this.dirtyFunctions = new Map();
        this.stringIndex = [];
        this.newStrStorage = Rope.from(this.module.strings.storage);
        this.newStrEntries = [];

        for (const entry of module.strings) {
            const length = entry.contents.length;
            const bIndex = bisect(this.stringIndex, length, b => b[0].contents.length);

            if (this.stringIndex[bIndex]?.[0].contents.length === length) {
                this.stringIndex[bIndex].push(entry);
            } else {
                this.stringIndex.splice(bIndex, 0, [entry]);
            }
        }
    }

    findString(str: string) {
        const bIndex = bisect(this.stringIndex, str.length, b => b[0].contents.length);

        return this.stringIndex[bIndex]?.find(e => e.contents === str);
    }

    findPartialString(str: string) {
        const bIndex = bisect(this.stringIndex, str.length, b => b[0].contents.length);

        for (let i = bIndex; i < this.stringIndex.length; i++) {
            for (const entry of this.stringIndex[i]) {
                if (entry.contents.includes(str)) {
                    return entry;
                }
            }
        }
    }

    addString(str: string) {
        // eslint-disable-next-line no-control-regex
        if (!/^[\x00-\x7f]*$/.test(str)) throw "todo"; // no utf-16 encoder

        const encoded = Utf8E.encode(str);

        const entry: StringTableEntry = {
            isUtf16: 0,
            length: encoded.length,
            offset: this.newStrStorage.length,
        };

        this.newStrStorage = this.newStrStorage.concat(Rope.from(encoded));
        this.newStrEntries.push(entry);
    }

    getMutable(id: number): MutableFunction {
        return this.dirtyFunctions.get(id)
            ?? new MutableFunction(this, this.module.functions[id]);
    }

    _setDirty(func: MutableFunction) {
        this.dirtyFunctions.set(func.inner.id, func);
    }

    modifyFunctions() {
        const module = this.module;

        for (const func of this.dirtyFunctions.values()) {
            const bytes = new Uint8Array(func.bytecode.length);

            let offset = 0;
            for (const leaf of func.bytecode.leaves()) {
                bytes.set(leaf, offset);
                offset += leaf.byteLength;
            };

            const bytecode = new ModuleBytecode(bytes, func.inner.bytecode.jumpTables);

            func.inner.bytecode = bytecode;
            module.bytecode.push(bytecode);
        }

        for (const entry of this.newStrEntries) {
            if (entry.length >= 1 << stringTableEntry.fields.length
                || entry.offset >= 1 << stringTableEntry.fields.offset) {

                entry.length = 0xff;
                entry.offset = module.strings.overflowEntries.length;
                module.strings.overflowEntries.push({ length: entry.length, offset: entry.offset });
            }

            module.strings.entries.push(entry);
        }

        const stringStorage = new Uint8Array(this.newStrStorage.length);
        let offset = 0;
        for (const leaf of this.newStrStorage.leaves()) {
            stringStorage.set(leaf, offset);
            offset += leaf.byteLength;
        }

        module.strings.storage = stringStorage;
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
