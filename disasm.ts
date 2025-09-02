import { parseModule } from "decompiler";
import type { FunctionHeader } from "decompiler/bitfields";
import { bigIntOperands, Builtin, functionOperands, Opcode, opcodeTypes, stringOperands } from "decompiler/opcodes";
import { appendFile, open, writeFile } from "fs/promises";
import { CYAN, drawGutter, GREEN, PURPLE, RED, RESET } from "./src/formatting.ts";

await using bundle = await open("discord/bundle.hbc");

const { size } = await bundle.stat();
const buffer = new ArrayBuffer(size);
await bundle.read(new Uint8Array(buffer));
await bundle.close();

const hermes = await parseModule(buffer);

await writeFile("bytecode.ansi", "");

for (const func of hermes.functions) {
  await appendFile("bytecode.ansi", disassemble(func.header, func.bytecode));
}

// this is bad
function disassemble(func: FunctionHeader, bytecode: Uint8Array) {
  const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);

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
  while (i < bytecode.length) {
    addresses.push(i);
    addr2line[i] = lines.length;

    const ip = i;
    const op = bytecode[i++] as Opcode;
    const name = Opcode[op];
    const types = opcodeTypes[op];

    let src = "";

    if (!name) {
      src += `${RED}invalid ${op}`;
      lines.push(src);
      continue;
    }

    src += `${PURPLE}${name}${RESET}`;

    for (let j = 0; j < types.length; j++) {
      const arg = types[j];
      if (j > 0) src += `,`;

      let value = 0, width = 0;

      if (arg === "Reg32" || arg === "UInt32" || arg === "Imm32") {
        value = view.getUint32(i, true), width = 4;
      } else if (arg === "Addr32") {
        value = view.getInt32(i, true), width = 4;
      } else if (arg === "UInt16") {
        value = view.getUint16(i, true), width = 2;
      } else if (arg === "Reg8" || arg === "UInt8") {
        value = view.getUint8(i), width = 1;
      } else if (arg === "Addr8") {
        value = view.getInt8(i), width = 1;
      } else if (arg === "Double") {
        value = view.getFloat64(i, true), width = 8;
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
        src += ` ${hermes.strings[hermes.functions[value].header.functionName]}#${value}`;
      } else if (bigIntOperands[op]?.includes(j + 1)) {
        src += ` ${hermes.bigInts[value]}n`;
      } else if ((op === Opcode.CallBuiltin || op === Opcode.CallBuiltinLong) && j == 1) {
        src += ` ${Builtin[value]}`;
      } else {
        src += ` ${value}`;
      }

      i += width;
    }

    lines.push(src);
  }

  const pointers = jumpSources.map((to, from) => ({ from: addr2line[from], to: addr2line[to] })).filter(n => n != null);
  if (pointers.some(({ from, to }) => from == null || to == null)) {
    throw new Error("Cannot draw pointers: some addresses undefined");
  }
  const gutter = drawGutter(lines.length, pointers, { colors: true, curved: true });

  lines = lines.map((line, i) => `${addresses[i].toString(16).padStart(8, "0")} ${gutter[i]} ${line}\n`);

  return `${mangled}(${params}):\n`
    + lines.join("");
}
