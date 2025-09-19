import { parseHermesModule } from "decompiler";
import type { HermesModule } from "decompiler/types";
import { createResource, createSignal, type Setter, Suspense } from "solid-js";
import { formatSizeUnit } from "../../utils/index.ts";

export function App() {
    const [progress, setProgress] = createSignal<[number, number]>([0, 0]);

    const [bundle] = createResource(async () => {
        const startTime = performance.now();

        const buffer = await readData(setProgress);
        const hermes = parseHermesModule(buffer);

        return {
            hermes,
            parseTime: performance.now() - startTime,
        };
    });

    const Progress = () => (
        <div>
            <progress value={progress()[0]} max={progress()[1]} /> <br />
            {progress().map(formatSizeUnit).join("/")}
        </div>
    );

    return (
        <Suspense fallback={<Progress />}>
            <View {...bundle()!} />
        </Suspense>
    );
}

function View(bundle: {
    hermes?: HermesModule;
    parseTime?: number;
}) {
    return (
        <div>
            Hermes file ({bundle.parseTime}ms) <br />
        </div>
    );
}

async function readData(setProgress: Setter<[number, number]>) {
    const file = await fetch("bundle.hbc");
    const fileSize = +file.headers.get("Content-Length")!;
    const reader = file.body!.getReader({ mode: "byob" });

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
    }

    return buffer;
}
