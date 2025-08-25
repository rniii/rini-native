import { type HermesHeader, parseHeader, segmentBody, segmentFile } from "decompiler";
import { type Bitfield, offsetLengthPair, smallFunctionHeader, stringTableEntry } from "decompiler/bitfields";
import { createEffect, createSignal, type JSXElement, on, type ParentProps, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { entries, formatSizeUnit, insort, mapValues } from "../../utils/index.ts";

const [progress, setProgress] = createStore([0, 0]);

interface BundleInfo {
  header: HermesHeader;
  buffer: ArrayBuffer;
  strings: string[];
}

const [bundleInfo, setBundleInfo] = createSignal<BundleInfo>();

const BundleView = (bundle: BundleInfo) => {
  return (
    <div>
      Hermes file v{bundle.header.version} <br />
      {formatSizeUnit(bundle.header.fileLength)}
    </div>
  );
};

export const App = () => {
  const Progress = () => {
    const currentTask = () => (progress[0], segmentTasks[0] ?? { name: "Unknown" });

    return (
      <div>
        <progress value={progress[0]} max={progress[1]} /> <br />
        {currentTask().name} {progress.map(formatSizeUnit).join("/")}
      </div>
    );
  };

  return (
    <div>
      <Show when={bundleInfo()} fallback={<Progress />}>
        <BundleView {...bundleInfo()!} />
      </Show>
    </div>
  );
};

const HexView = (props: { start?: number; bytes: Uint8Array }) => {
  const ROW_SIZE = 16;

  const rows = () =>
    Array.from(Array(Math.ceil(props.bytes.length / ROW_SIZE)), (_, i) => (
      props.bytes.slice(i * ROW_SIZE, i * ROW_SIZE + ROW_SIZE)
    ));

  const color = (b: number) => b > 0x7f ? "#9be099" : b == 0 ? "#909090" : b < 0x20 ? "#97d0e8" : "white";

  const byte = (b: number, i: number) => (
    <span style={{ color: color(b) }}>
      {b.toString(16).padStart(2, "0").padStart(2 + +!(i % 2) + +!(i % 8))}
    </span>
  );

  const char = (b: number) => (
    <span style={{ color: color(b) }}>
      {b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."}
    </span>
  );

  const start = () => props.start ?? 0;

  return (
    <pre>
      {rows().map((row, i) => (
        <div>{(start() + i * 16).toString(16).padStart(8, "0")}{Array.from(row, byte)}</div>
      ))}
    </pre>
  );
};

interface SegmentTasks {
  name: string;
  byteOffset: number;
  byteLength: number;
  callback(buf: ArrayBuffer): void;
}

const segmentTasks = [] as SegmentTasks[];

const Utf8D = new TextDecoder("utf-8");
const Utf16D = new TextDecoder("utf-16");

queueMicrotask(async () => {
  const file = await fetch("index.android.bundle");
  const fileSize = +file.headers.get("Content-Length")!;
  const reader = file.body!.getReader({ mode: "byob" });

  const bundle = readBundle();

  const header = await segment("Hermes header", [0, 128], parseHeader);
  if (header.fileLength !== fileSize) throw Error("Header has invalid fileSize");

  const positions = segmentFile(header);

  const functionHeaders = await segment("Function headers", positions.functionHeaders, buf => {
    segmentBody(header, parseArray(header.functionCount, smallFunctionHeader, buf));
  });

  const stringTable = await segment(
    "Short strings",
    positions.stringTable,
    buf => parseArray(header.stringCount, stringTableEntry, buf),
  );

  const overflowStrings = await segment(
    "Strings",
    positions.overflowStringTable,
    buf => parseArray(header.overflowStringCount, offsetLengthPair, buf),
  );

  const strings = await segment("String data", positions.stringStorage, buf => {
    const strings = [];

    for (let { isUtf16, offset, length } of stringTable) {
      if (length == 0xff) ({ offset, length } = overflowStrings[offset]);

      const data = new Uint8Array(buf, offset, isUtf16 ? length * 2 : length);
      strings.push((isUtf16 ? Utf16D : Utf8D).decode(data));
    }

    return strings;
  });

  const buffer = await bundle;

  setBundleInfo({
    header,
    buffer,
    strings,
  });

  function parseArray<K extends string>(count: number, bitfield: Bitfield<K>, buf: ArrayBuffer) {
    return Array.from(Array(count), (_, i) => bitfield.parseElement(new Uint8Array(buf), i));
  }

  function segment<T>(name: string, position: [number, number], handle: (buf: ArrayBuffer) => T) {
    return new Promise<T>(resolve => {
      insort(segmentTasks, {
        name,
        byteOffset: position[0],
        byteLength: position[1],
        callback: buf => resolve(handle(buf)),
      }, task => task.byteOffset);
    });
  }

  async function readBundle() {
    let buffer = new ArrayBuffer(fileSize);
    let offset = 0;
    let chunk: Uint8Array | undefined;

    const nextChunk = async () => {
      const { value } = await reader.read(new Uint8Array(buffer, offset, fileSize - offset));
      return value;
    };

    while (offset < fileSize && (chunk = await nextChunk())) {
      buffer = chunk.buffer;
      offset += chunk.byteLength;

      setProgress([offset, fileSize]);

      while (segmentTasks[0]) {
        const segment = segmentTasks[0];
        if (segment.byteOffset + segment.byteLength > offset) break;

        const data = buffer.slice(segment.byteOffset, segment.byteOffset + segment.byteLength);

        segment.callback(data);
        segmentTasks.shift();
      }
    }

    return buffer;
  }
});
