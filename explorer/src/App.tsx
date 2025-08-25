import { createStreamReader, type HermesHeader, parseFile, type PendingSegment } from "decompiler";
import { createSignal, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { formatSizeUnit } from "../../utils/index.ts";

const [progress, setProgress] = createStore([0, 0]);

interface BundleInfo {
  header: HermesHeader;
  buffer: ArrayBuffer;
  strings: string[];
  parseTime: number;
}

const [bundleInfo, setBundleInfo] = createSignal<BundleInfo>();

const BundleView = (bundle: BundleInfo) => {
  return (
    <div>
      Hermes file v{bundle.header.version} ({bundle.parseTime}ms) <br />
      {formatSizeUnit(bundle.header.fileLength)}
    </div>
  );
};

export const App = () => {
  const Progress = () => {
    const currentTask = () => (progress[0], pendingSegments[0] ?? { name: "Unknown" });

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

let pendingSegments = [] as PendingSegment[];

queueMicrotask(async () => {
  const file = await fetch("index.android.bundle");
  const fileSize = +file.headers.get("Content-Length")!;

  let reader;
  ({ reader, pendingSegments } = createStreamReader(file.body!, fileSize, (_, offset) => {
    setProgress([offset, fileSize]);
  }));

  await parseFile(reader);
});
