import { Instruction } from "./instruction.ts";
import type { HermesModule } from "./module.ts";
import type { MutableFunction } from "./mutable.ts";
import { ArgType, Opcode, opcodeTypes } from "./opcodes.ts";
import { Rope } from "./rope.ts";

interface BytecodeInfo {
    labels: number[];
    offsets: number[];
}

const ansi = (c = "") => `\x1b[${c}m`;

const DIFF_INS = ansi("32");
const DIFF_DEL = ansi("31");
const OPCODE = ansi("35");
const RESET = ansi();
const BOLD = ansi("1");

enum Hunk {
    Deleted = -1,
    Unchanged,
    Inserted,
}

export class Disassembler {
    doColor = true;

    bcCache = new WeakMap<any, BytecodeInfo>();

    constructor(
        public module: HermesModule,
    ) {}

    diffMutable(mutable: MutableFunction) {
        const original = this.module.functions[mutable.id];

        const oldBc = original.bytecode.opcodes;
        const newBc = mutable.bytecode;

        // const oldInfo = this.getInfo(oldBc);
        // const newInfo = this.getInfo(newBc);

        const hunks: [Hunk, Uint8Array][] = [];

        let offset = oldBc.byteOffset;
        for (const leaf of newBc.leaves()) {
            if (leaf.buffer !== oldBc.buffer || leaf.byteOffset < offset) {
                hunks.push([Hunk.Inserted, leaf]);
            } else {
                const deleted = new Uint8Array(oldBc.buffer, offset, leaf.byteOffset - offset);

                hunks.push([Hunk.Deleted, deleted]);
                hunks.push([Hunk.Unchanged, leaf]);

                offset = leaf.byteOffset + leaf.byteLength;
            }
        }

        if (offset < oldBc.byteOffset + oldBc.byteLength) {
            hunks.push([Hunk.Deleted, oldBc.subarray(oldBc.byteOffset - offset)]);
        }

        let src = "";
        for (const [diff, leaf] of hunks) {
            if (leaf.byteLength === 0) continue;

            if (diff === Hunk.Unchanged) {
                for (const { text } of this.disassembleBytes(leaf)) {
                    src += `  ${text}\n`;
                }
            } else {

                for (const { text } of this.disassembleBytes(leaf, BOLD)) {
                    src += diff < 0 ? this.color`${DIFF_DEL}- ${text}\n` : `${DIFF_INS}+ ${text}\n`;
                }

            }
        }

        return src;
    }

    *disassembleBytes(bc: Uint8Array, color = OPCODE) {
        for (const instr of Instruction.iterate(bc)) {
            const name = Opcode[instr.opcode];
            const args = Array.from(instr.operands(), (arg, i) => {
                switch (opcodeTypes[instr.opcode][i]) {
                    case ArgType.Reg8:
                    case ArgType.Reg32:
                        return `r${arg}`;
                    case ArgType.UInt8:
                    case ArgType.Addr8:
                    case ArgType.UInt16:
                    case ArgType.UInt32:
                    case ArgType.Imm32:
                    case ArgType.Addr32:
                    case ArgType.Double:
                        return `${arg}`;
                }
            });

            const text = this.color`${color}${name} ${RESET}${args.join(", ")}`;

            yield { ip: instr.ip, text, notes: `` };
        }
    }

    getInfo(bc: Uint8Array | Rope<Uint8Array>) {
        const cached = this.bcCache.get(bc);
        if (cached) return cached;

        if (bc instanceof Uint8Array) bc = Rope.from(bc);

        const labels: number[] = [];
        const offsets: number[] = [];

        let offset = 0;
        for (const leaf of bc.leaves()) {
            for (const instr of Instruction.iterate(leaf)) {
                offsets.push(offset + instr.ip);
                offset += instr.width;
            }
        }

        const bcInfo: BytecodeInfo = { labels, offsets };
        this.bcCache.set(bc, bcInfo);

        return bcInfo;
    }

    color(text: TemplateStringsArray, ...values: any[]) {
        return String.raw({ raw: text }, ...values.map(v => {
            if (typeof v == "string" && v[0] === "\x1b") return this.doColor ? v : "";

            return v;
        }));
    }
}
