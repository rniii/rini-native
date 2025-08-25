import { type HermesHeader, type HermesSegments, parseFile } from "decompiler";
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

const file = await parseFile((_, byteOffset, byteLength, callback) => {
  callback(data.subarray(byteOffset, byteOffset + byteLength));
});

console.log(data);
console.log(dumpFile(file));

function dumpFile(file: {
  header: HermesHeader;
  segments: Record<HermesSegments, Uint8Array>;
}) {
  const parts = [
    new Uint8Array(128),
    ...Object.values(file.segments),
  ];

  const size = parts.reduce((acc, x) => acc + padSize(x.byteLength), 0);
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);

  const header: HermesHeader = {
    ...file.header,
    fileLength: size,
  };

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

  return data;
}
