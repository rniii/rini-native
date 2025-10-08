import { ModuleBytecode, ModuleFunction, type PartialFunctionHeader } from "./function.ts";
import { encodeInstructions, Instruction, opcodeWidths, type ParsedArguments, type RawArguments, type RawInstruction } from "./instruction.ts";
import type { HermesModule, UniqueString } from "./module.ts";
import { longOpcodes, type Opcode } from "./opcodes.ts";
import { Rope } from "./rope.ts";

export class ModulePatcher {
    dirtyFunctions = new Map<number, MutableFunction>();

    stringIndex: UniqueString[];

    constructor(public module: HermesModule) {
        this.stringIndex = Array.from(module.strings);
        this.stringIndex.sort((a, b) => a.contents.length - b.contents.length);
    }

    findString(str: string): number {
        const entry = this.stringIndex.find(v => v.contents.startsWith(str));
        if (!entry) throw Error(`String ${JSON.stringify(str)} was not found`);

        return entry.id;
    }

    getMutable(id: number): MutableFunction {
        const dirty = this.dirtyFunctions.get(id);
        if (dirty) return dirty;

        return new MutableFunction(this, this.module.functions[id]);
    }

    createFunction(instrs: RawInstruction[], options: {
        paramCount: number;
    }) {
        const id = this.module.functions.length;
        const header: PartialFunctionHeader = {
            paramCount: options.paramCount,
            functionName: this.stringIndex[0].id,
            frameSize: 0,
            environmentSize: 0,
            highestReadCacheIndex: 0,
            highestWriteCacheIndex: 0,
            prohibitInvoke: 0,
            strictMode: 1,
        };
        const bytecode = new ModuleBytecode(encodeInstructions(instrs));

        this.module.functions.push(new ModuleFunction(id, header, bytecode));
        this.module.bytecode.push(bytecode);

        return id;
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

    match<const Q extends InstructionQuery[]>(...queries: Q): ContiguousMatch<Q> {
        const normalisedQuery = queries.map(q => (
            q.map(value => {
                if (typeof value === "string") return this.patcher.findString(value);
                if (typeof value === "bigint") throw "todo";

                return value;
            })
        ));

        const matches = (instr: Instruction, query: RawOperandsQuery) => {
            return query[0] === instr.opcode
                && instr.operands().every((arg, i) => query[i + 1] === null || arg === query[i + 1]);
        };

        let match: Instruction[] = [];

        for (const instr of this.instructions()) {
            if (matches(instr, normalisedQuery[match.length])) {
                match.push(instr);
            } else {
                match = [];
            }

            if (match.length >= queries.length) return match.map(instr => new MutableInstruction(this, instr)) as any;
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

    _markDirty() {
        this.patcher.dirtyFunctions.set(this.inner.id, this);
    }
}

type MutableArguments<Op extends Opcode> =
    RawArguments<Op> extends infer Args extends ReadonlyArray<any>
        ? { -readonly [K in keyof Args]: number }
        : never;

type OperandsQuery<Op extends Opcode> =
    ParsedArguments<Op> extends infer ParsedArgs extends ReadonlyArray<any>
        ? { [Index in keyof ParsedArgs]: ParsedArgs[Index] | null }
        : never;

type RawOperandsQuery = (number | null)[];

type InstructionQuery<Op extends Opcode = Opcode> = Op extends unknown ? [Op, ...OperandsQuery<Op>] : never;

type ContiguousMatch<Q extends InstructionQuery[]> = {
    [Index in keyof Q]: MutableInstruction<Q[Index][0]>;
};

export class MutableInstruction<Op extends Opcode> {
    ip: number;
    opcode: Op;
    width: number;
    args: MutableArguments<Op>;

    constructor(public func: MutableFunction, instr: Instruction) {
        this.ip = instr.ip;
        this.opcode = instr.opcode as Op;
        this.width = instr.width;
        this.args = new Proxy([...instr.operands()], {
            set: (t, key, val, recv) => {
                const dirty = typeof key == "string" && +key && val !== t[+key];
                const ok = Reflect.set(t, key, val, recv);

                if (dirty) this._updateBytecode();

                return ok;
            },
        }) as any;
    }

    _updateBytecode(): void {
        const bytes = new Uint8Array(opcodeWidths[this.opcode]);
        bytes[0] = this.opcode;

        const instr = new Instruction(0, new DataView(bytes.buffer));

        try {
            this.args.forEach((arg, i) => instr.setOperand(i, arg));
        } catch (err) {
            const long = longOpcodes[this.opcode];
            if (long == null) throw err;

            // @ts-expect-error nothing to see here
            this.opcode = long;
            return this._updateBytecode();
        }

        this.func.bytecode = this.func.bytecode.replace(this.ip, this.ip + this.width, Rope.from(bytes));
        this.func._markDirty();
    }
}
