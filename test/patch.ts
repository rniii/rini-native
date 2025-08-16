import { smallFunctionHeader } from "../decompiler/src/bitfields.ts";
import { parseHeader, segmentBody, segmentFile } from "../decompiler/src/index.ts";
import { entries } from "../utils/index.ts";

const file = Buffer.from(
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
);
const buf = new Uint8Array(file).buffer;

const header = parseHeader(buf);
const segments = segmentFile(header);
const functions = Array.from(
  Array(header.functionCount),
  (_, i) => smallFunctionHeader.parseElement(new Uint8Array(buf, ...segments.functionHeaders), i),
);

console.log(functions);

const funch = {
  offset: 196,
  paramCount: 1,
  bytecodeSizeInBytes: 24,
  functionName: 1,
  infoOffset: 220,
  frameSize: 11,
  environmentSize: 0,
  highestReadCacheIndex: 2,
  highestWriteCacheIndex: 0,
  prohibitInvoke: 2,
  strictMode: 0,
  hasExceptionHandler: 0,
  hasDebugInfo: 1,
  overflowed: 0,
};

const b = new Uint8Array(32);
const view = new DataView(b.buffer);

let bit = 0;
for (const [segment, size] of entries(smallFunctionHeader.fields)) {
  let div = bit / 8 | 0;
  let rem = bit % 8;

  let word = view.getInt32(div, true);
  word |= (funch[segment]) << rem;
  view.setInt32(div, word, true);

  bit += size;
}

// console.log(smallFunctionHeader.parse(b));

function dumpFile() {
  const header = new Uint8Array(128);

  return [
    header,
    ...Object.values(segments).map(x => new Uint8Array(buf, ...x)),
  ];
}
