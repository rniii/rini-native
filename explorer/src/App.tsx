import { type HermesSegments, parseHeader, segmentFile } from "decompiler";
import { createSignal, Show } from "solid-js";
import { entries, formatSizeUnit, fromEntries } from "../../utils";
import { createStore } from "solid-js/store";

const [progress, setProgress] = createStore([0, 0]);

interface BundleInfo {
  buffer: ArrayBuffer;
  segments: Record<HermesSegments, Uint8Array>;
}

const [bundleInfo, setBundleInfo] = createSignal<BundleInfo>();

export const App = () => {
  return (
    <div>
      <progress value={progress[0]} max={progress[1]} /> {progress.map(formatSizeUnit).join("/")}
      <Show when={bundleInfo()}>
        {Object.entries(bundleInfo()!.segments ?? {}).map(([name, data]) => (
          <div>
            {name}: {formatSizeUnit(data.length)}
            <HexView start={data.byteOffset} bytes={data.slice(0, 128)} />
          </div>
        ))}
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

  const byte = (b: number, i: number) => (
    <span style={{ color: b > 0x7f ? "pink" : b == 0 ? "gray" : b < 0x20 ? "lightblue" : "white" }}>
      {b.toString(16).padStart(2, "0").padStart(2 + +!(i % 2) + +!(i % 8))}
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
  callback(buf: Uint8Array): Promise<void>;
}

const segmentTasks = [] as SegmentTasks[];

queueMicrotask(async () => {
  const file = await fetch("index.android.bundle");
  const size = +file.headers.get("Content-Length")!;
  const reader = file.body!.getReader({ mode: "byob" });

  const bundle = readBundle();

  const header = await segment("Hermes header", 0, 128, buf => parseHeader(buf.buffer));
  const indexSegments = segmentFile(header);
  const indexSize = entries(indexSegments).reduce((acc, [, [, size]]) => acc + size, 0);

  console.log(header);

  const indexes = await segment("Parsing indexes", 128, indexSize, buf => {});

  // console.log(indexes.length);

  const buffer = await bundle;

  setBundleInfo({
    buffer,
    segments: fromEntries(
      entries(indexSegments).map(([name, [offset, size]]) => [name, new Uint8Array(buffer, offset, size)]),
    ),
  });

  function segment<T>(
    name: string,
    byteOffset: number,
    byteLength: number,
    handle: (buf: Uint8Array) => Promise<T> | T,
  ) {
    return new Promise<T>(resolve => {
      segmentTasks.push({
        name,
        byteOffset,
        byteLength,
        async callback(buf) {
          resolve(await handle(buf));
        },
      });
    });
  }

  async function readBundle() {
    let buffer = new ArrayBuffer(size);
    let offset = 0;
    let chunk: Uint8Array | undefined;

    const nextChunk = async () => {
      const { value } = await reader.read(new Uint8Array(buffer, offset, size - offset));
      return value;
    };

    while (offset < size && (chunk = await nextChunk())) {
      buffer = chunk.buffer;
      offset += chunk.byteLength;

      for (let i = 0; i < segmentTasks.length; i++) {
        const segment = segmentTasks[i];
        if (segment.byteOffset + segment.byteLength > offset) continue;

        const data = new Uint8Array(buffer, segment.byteOffset, segment.byteLength);

        await segment.callback(data);
        segmentTasks.splice(i--, 1);
      }

      setProgress([offset, size]);
    }

    return buffer;
  }
});
