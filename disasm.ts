import type { largeFunctionHeader } from "@/bitfields";
import { Opcode, opcodeTypes, stringOperands } from "@/opcodes";
import { parseFile, readFile } from "@/parser";
import { open } from "fs/promises";

const file = await readFile(await open("base/assets/index.android.bundle"));
const parser = parseFile(file);
const functions = await parser.functionHeaders;
const strings = await parser.stringStorage;
const func = functions[3];

console.log(
  functions.map((f, i) => f.functionName != 255 && [i, strings[f.functionName]]).filter(x => x).slice(0, 128),
);

const color = (c?: number) => `\x1b[${c ?? ""}m`;
const red = color(31);
const green = color(32);
const purple = color(35);
const cyan = color(36);
const reset = color();

function disassemble(func: ReturnType<typeof largeFunctionHeader.parse>, buf: Buffer) {
  const name = strings[func.functionName] || "<closure>";
  const addr = "0x" + func.offset.toString(16).padStart(8, "0");
  const mangled = `${cyan}${name}@${green}${addr}${reset}`;
  const params = Array.from(Array(func.paramCount), (_, i) => `r${i}`).join(", ");

  // there should be an array of instructions instead of the source liens but im lazy
  const lines = [] as string[];
  const addresses = [] as number[];
  const addr2line = [] as number[];
  const jumpSources = [] as number[];
  const jumpTargets = [] as number[];

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
      src += `${red}invalid ${op}`;
      lines.push(src);
      continue;
    }

    src += `${purple}${name.padEnd(24)}${reset}`;

    try {
      for (let j = 0; j < types.length; j++) {
        const arg = types[j];
        if (j > 0) src += `,`;

        let value = 0, width = 0;

        if (arg == "Reg32" || arg == "UInt32") {
          value = buf.readUint32LE(i), width = 4;
        } else if (arg == "Addr32") {
          value = buf.readInt32LE(i), width = 4;
        } else if (arg == "UInt16") {
          value = buf.readUint16LE(i), width = 2;
        } else if (arg == "Reg8" || arg == "UInt8") {
          value = buf.readUint8(i), width = 1;
        } else if (arg == "Addr8") {
          value = buf.readInt8(i), width = 1;
        } else if (arg == "Double") {
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
      src += ` ${red}<truncated>`;
      continue;
    }

    lines.push(src);
  }

  // has some jank:
  // -  backward jump logic not there yet (just reverse source and target and check < addr)
  // -  targets with multiple sources kinda break
  // -  function index number 5 really breaks this
  // -  when there are too many jumps to allocate a lane, it should point offscreen, but the same
  //    has to be done in the target
  //
  // gl

  const lanes = [null, null, null, null, null, null as number | null];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const addr = addresses[i];
    let prefix = "";
    let j = 0;

    if (jumpSources[addr] && jumpSources[addr] > addr) {
      j = lanes.findLastIndex(x => x == null);

      prefix = lanes.map((lane, i) => {
        if (i == j) return "┌";
        return lane == null ? " " : "│";
      }).join("") + "─";

      lanes[j] = jumpSources[addr];
    } else if (jumpTargets[addr] && (j = lanes.indexOf(addr)) >= 0) {
      prefix = lanes.map((lane, i) => {
        if (i == j) return "└";
        if (i > j) return lane == null ? "─" : "┼"; // not great (ambiguous)
        return lane == null ? " " : "│";
      }).join("") + ">";

      lanes[j] = null;
    } else {
      prefix = lanes.map(lane => lane == null ? " " : "│").join("") + " ";
    }

    lines[i] = prefix.padStart(lanes.length + 2) + line;
  }

  // const arrows = [] as (number | null)[];

  // lines.map((line, i) => {
  //   const addr = addresses[i];
  //   let j;

  //   if (jumpSources[addr] && jumpSources[addr] > addr) {
  //     lines[i] = ("┌" + "─".repeat(arrows.length)).padStart(7) + " " + line;
  //     arrows.push(jumpSources[addr]);
  //   } else if (jumpTargets[addr] && (j = arrows.indexOf(addr)) >= 0) {
  //     arrows[j] = null;

  //     lines[i] = "└>".padStart(8) + line;
  //   } else {
  //     lines[i] = "│".repeat(arrows.length).padStart(7) + " " + line;
  //   }
  // });

  return `${mangled}(${params}):\n`
    + lines.join("\n");
}

const buf = Buffer.alloc(func.bytecodeSizeInBytes);
await file.handle.read(buf, 0, func.bytecodeSizeInBytes, func.offset);

console.log(disassemble(func, buf));
