import type { LargeFunctionHeader } from "decompiler/bitfields";
import { open } from "fs/promises";
import { CYAN, drawGutter, GREEN, PURPLE, RED, RESET } from "./src/formatting.ts";
import { bigIntOperands, functionOperands, Opcode, opcodeTypes, stringOperands } from "./decompiler/src/opcodes.ts";
import { parseFile } from "decompiler";

const file = await open("./test/index.android.bundle");

const hermes = await parseFile((_, byteOffset, byteLength, callback) => {
});

// console.table(file.header)

// for (const func of functions) {
//   const buf = Buffer.alloc(func.bytecodeSizeInBytes);
//   await file.handle.read(buf, 0, func.bytecodeSizeInBytes, func.offset);
//   console.log(disassemble(func, buf));
// }

// console.table(functions.reduce((a, b) => a.bytecodeSizeInBytes > b.bytecodeSizeInBytes ? a : b))

// const buf = Buffer.alloc(678661);
// await file.handle.read(buf, 0, 678661, 27117765);
// console.log(disassemble(functions[0], buf));

// const func = hermes.functions[9];
// const buf = Buffer.alloc(func.bytecodeSizeInBytes);
// await file.handle.read(buf, 0, func.bytecodeSizeInBytes, func.offset);
// console.log(disassemble(func, buf));

// console.log(strings.slice(0,128))

// for (const func of functions) {
//   if (!strings[func.functionName]) continue;

//   const buf = Buffer.alloc(func.bytecodeSizeInBytes);
//   await file.handle.read(buf, 0, func.bytecodeSizeInBytes, func.offset);

//   console.log(disassemble(func, buf));
// }

// this is bad
function disassemble(func: LargeFunctionHeader, buf: Buffer) {
  const name = hermes.strings[func.functionName] || "<closure>";
  const addr = "0x" + func.offset.toString(16).padStart(8, "0");
  const mangled = `${CYAN}${name}@${GREEN}${addr}${RESET}`;
  const params = Array.from(Array(func.paramCount), (_, i) => `r${i}`).join(", ");

  const addresses: number[] = [];
  const addr2line: number[] = [];
  let lines: string[] = [];
  const jumpSources: number[] = [];
  const jumpTargets: number[] = [];

  let i = 0;
  while (i < buf.length) {
    addresses.push(i);
    addr2line[i] = lines.length;

    const ip = i;
    const op = buf[i++] as Opcode;
    const name = Opcode[op];
    const types = opcodeTypes[op];

    let src = "";

    if (!name) {
      src += `${RED}invalid ${op}`;
      lines.push(src);
      continue;
    }

    src += `${PURPLE}${name}${RESET}`;

    try {
      for (let j = 0; j < types.length; j++) {
        const arg = types[j];
        if (j > 0) src += `,`;

        let value = 0, width = 0;

        if (arg === "Reg32" || arg === "UInt32" || arg === "Imm32") {
          value = buf.readUint32LE(i), width = 4;
        } else if (arg === "Addr32") {
          value = buf.readInt32LE(i), width = 4;
        } else if (arg === "UInt16") {
          value = buf.readUint16LE(i), width = 2;
        } else if (arg === "Reg8" || arg === "UInt8") {
          value = buf.readUint8(i), width = 1;
        } else if (arg === "Addr8") {
          value = buf.readInt8(i), width = 1;
        } else if (arg === "Double") {
          value = buf.readDoubleLE(i), width = 8;
        }

        if (arg.startsWith("Reg")) {
          src += ` r${value}`;
        } else if (arg.startsWith("Addr")) {
          const addr = ip + value;
          src += ` 0x${addr.toString(16).padStart(8, "0")}`;
          jumpSources[ip] = addr;
          jumpTargets[addr] = ip;
        } else if (stringOperands[op]?.includes(j + 1)) {
          src += ` ${JSON.stringify(hermes.strings[value])}`;
        } else if (functionOperands[op]?.includes(j + 1)) {
          src += ` ${hermes.strings[hermes.functions[value].functionName]}#${value}`;
        } else if (bigIntOperands[op]?.includes(j + 1)) {
          src += ` ${hermes.bigInts[value]}n`;
        } else {
          src += ` ${value}`;
        }

        i += width;
      }
    } catch {
      src += ` ${RED}<truncated>`;
      continue;
    }

    lines.push(src);
  }

  const pointers = jumpSources.map((to, from) => ({ from: addr2line[from], to: addr2line[to] })).filter(n => n != null);
  if (pointers.some(({ from, to }) => from == null || to == null)) {
    throw new Error("Cannot draw pointers: some addresses undefined");
  }
  const gutter = drawGutter(lines.length, pointers, { colors: true, curved: true });

  lines = lines.map((line, i) => `${addresses[i].toString(16).padStart(8, "0")} ${gutter[i]} ${line}`);

  return `${mangled}(${params}):\n`
    + lines.join("\n");
}
