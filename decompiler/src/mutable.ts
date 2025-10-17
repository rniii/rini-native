import { bisect } from "../../utils/index.ts";
import { type StringTableEntry, stringTableEntry } from "./bitfields.ts";
import type { DebugOffsets, ExceptionHandler, ModuleBytecode, ModuleFunction, PartialFunctionHeader } from "./function.ts";
import { Instruction } from "./instruction.ts";
import type { HermesModule } from "./module.ts";
import { Rope } from "./rope.ts";

const Utf8E = new TextEncoder();

export class ModulePatcher {
    dirtyFunctions: Map<number, MutableFunction>;

    /** Sorted array of buckets of strings with the same length */
    stringIndex: { index: number; value: string }[][];
    newStrStorage: Rope<Uint8Array>;
    newStrEntries: StringTableEntry[];

    constructor(public original: HermesModule) {
        this.dirtyFunctions = new Map();
        this.stringIndex = [];
        this.newStrStorage = Rope.from(this.original.strings.storage);
        this.newStrEntries = [];

        for (let index = 0; index < original.strings.length; index++) {
            const value = original.strings.get(index);
            const bIndex = bisect(this.stringIndex, value.length, b => b[0].value.length);

            if (this.stringIndex[bIndex]?.[0].value.length === value.length) {
                this.stringIndex[bIndex].push({ index, value });
            } else {
                this.stringIndex.splice(bIndex, 0, [{ index, value }]);
            }
        }
    }

    findString(str: string) {
        const bIndex = bisect(this.stringIndex, str.length, b => b[0].value.length);

        return this.stringIndex[bIndex]?.find(e => e.value === str);
    }

    findPartialString(str: string) {
        const bIndex = bisect(this.stringIndex, str.length, b => b[0].value.length);

        for (let i = bIndex; i < this.stringIndex.length; i++) {
            for (const entry of this.stringIndex[i]) {
                if (entry.value.includes(str)) {
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
            ?? new MutableFunction(this, this.original.functions[id]);
    }

    _setDirty(func: MutableFunction) {
        this.dirtyFunctions.set(func.id, func);
    }

    modifyFunctions() {
        const module = this.original;

        for (const func of this.dirtyFunctions.values()) {
            const bytes = new Uint8Array(func.bytecode.length);

            let offset = 0;
            for (const leaf of func.bytecode.leaves()) {
                bytes.set(leaf, offset);
                offset += leaf.byteLength;
            };

            const bytecode: ModuleBytecode = {
                opcodes: bytes,
                jumpTables: func.jumpTables,
            };

            module.functions[func.id] = {
                id: func.id,
                header: func.header,
                bytecode,
                exceptionHandlers: func.exceptionHandlers,
                debugOffsets: func.debugOffsets,
            };
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
    id: number;
    header: PartialFunctionHeader;
    bytecode: Rope<Uint8Array>;
    jumpTables?: Uint8Array;
    exceptionHandlers?: ExceptionHandler[];
    debugOffsets?: DebugOffsets;

    constructor(public module: ModulePatcher, inner: ModuleFunction) {
        this.id = inner.id;
        this.header = { ...inner.header };
        this.bytecode = Rope.from(inner.bytecode.opcodes);
        this.jumpTables = inner.bytecode.jumpTables;
        this.exceptionHandlers = inner.exceptionHandlers?.map(e => [...e]);
        this.debugOffsets = inner.debugOffsets && [...inner.debugOffsets];
    }

    replace(start: number, end: number, bytes: Uint8Array) {
        this.bytecode = this.bytecode.replace(start, end, Rope.from(bytes));
        this.module._setDirty(this);
    }

    remove(start: number, end: number) {
        this.bytecode = this.bytecode.remove(start, end);
        this.module._setDirty(this);
    }

    insert(index: number, bytes: Uint8Array) {
        this.bytecode = this.bytecode.insert(index, Rope.from(bytes));
        this.module._setDirty(this);
    }

    *iterate(start?: number, end?: number) {
        const slice = this.bytecode.slice(start, end);

        for (const leaf of slice.leaves()) {
            yield* Instruction.iterate(leaf);
        }
    }
}
