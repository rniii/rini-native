import { open } from "fs/promises";
import type { largeFunctionHeader } from "./decompiler/src/bitfields";
import { CYAN, drawGutter, GREEN, PURPLE, RED, RESET } from "./src/formatting";
import { functionOperands, Opcode, opcodeTypes, stringOperands } from "./src/opcodes";
import { parseFile, readFile } from "./src/parser";

const file = await readFile(await open("./test/index.android.bundle"));
const parser = parseFile(file);
const functions = await parser.functionHeaders;
const strings = await parser.stringStorage;
const func = functions[0];

// console.log(
//   functions.map((f, i) => f.functionName != 255 && [i, strings[f.functionName]]).filter(x => x).slice(0, 128),
// );

function disassemble(func: ReturnType<typeof largeFunctionHeader.parse>, buf: Buffer) {
  const name = strings[func.functionName] || "<closure>";
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

    src += `${PURPLE}${name.padEnd(24)}${RESET}`;

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
          const str = strings[value];
          src += ` '${str.length > 64 ? str.slice(0, 63) + "…" : str}'`;
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

const buf = Buffer.alloc(func.bytecodeSizeInBytes);
await file.handle.read(buf, 0, func.bytecodeSizeInBytes, func.offset);

console.log(disassemble(func, buf));
