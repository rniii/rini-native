import { HERMES_SIGNATURE, type BytecodeHeader, type BytecodeModule, parseModule } from "decompiler";
import { padSize } from "../utils/index.ts";

const data = new Uint8Array(Buffer.from(
  `
    xh+8A8EDGR9gAAAAOmSrCmxctJU4IRJ2apSp0zTITUJdAQAAAAAAAAEAAAACAAAAAgAAAAQAAAAA
    AAAAEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADoAAAAAAAAAAAA
    AAAAAAAAAAAAAAAAAADEAAACGIAAANwAABYAAgASAgAAAAIAAIAI6DUc/SuaYgAAAAUKAAAGBgAA
    AxYAAAdoZWxsb2dsb2JhbGNvbnNvbGUAADAAOQIAAQMANgECAgJzAAAAUwABAgBcAAAAAAAAAAAA
    AAAAAAEAAAAOAAAAAQAAAB8AAAAiAAAAIwAAACMAAAAAAAAADgAAAHRlc3Qvc2FtcGxlLmpzAAAA
    AAAAAAAAAAAAAAEBAgAAAP////8PBgALAP////8PCQAAAP////8Pf38AAABuJuS8E5P6l0EXhgjf
    Zsz6XlzlDw==
  `,
  "base64",
));

const file = await parseModule((_, byteOffset, byteLength, callback) => {
  callback(data.subarray(byteOffset, byteOffset + byteLength));
});

const dumped = dumpFile(file);

console.log(data.length, dumped.length);

for (let i = 0; i < data.length; i++) {
  if (data[i] === dumped[i]) continue;

  console.log(`File differs from ${i}: `);
  console.log(data.slice(i));
  console.log(dumped.slice(i));
  break;
}

console.log(file.header);
console.log(file.functions[0]);

function dumpHeader(header: BytecodeHeader, data: Uint8Array) {
  const view = new DataView(data.buffer);

  view.setBigInt64(0, HERMES_SIGNATURE, true);

  let i = 8;
  for (const field in header) {
    if (field === "hash") {
      data.set(header[field], i);
      i += 20;
    } else {
      view.setUint32(i, (header as any)[field], true);
      i += 4;
    }
  }
}

function dumpFile(module: BytecodeModule): Uint8Array {
  const parts = [
    new Uint8Array(128),
    ...Object.values(module.segments),
    ...module.functions.map(h => h.bytecode),
  ];

  for (const func of module.functions) {
    if (func.header.hasExceptionHandler) {
      // TODO
    }

    if (func.header.hasDebugInfo) {
      parts.push(new Uint8Array(12));
    }
  }

  parts.push(
    new Uint8Array(
      module.buffer,
      module.header.debugInfoOffset,
      module.header.fileLength - module.header.debugInfoOffset, // - 20 (file ends with hash)
    ),
  );

  const size = parts.reduce((acc, x) => acc + padSize(x.byteLength), 0);

  module.header.fileLength = 349;

  dumpHeader(module.header, parts[0]);

  const data = new Uint8Array(size);

  let i = 0;
  for (const part of parts) {
    data.set(part, i);
    i += padSize(part.byteLength);
  }

  return data;
}
