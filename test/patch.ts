import { type BytecodeHeader, type BytecodeModule, HERMES_SIGNATURE, parseModule } from "decompiler";
import { readFile } from "node:fs/promises";
import { padSize } from "../utils/index.ts";

const data = new Uint8Array(await readFile("./test/sample.hbc"));

const file = parseModule(data.buffer);

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
console.log(file.functions);

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
        ...Object.values(module.segments).map(s => [s, new Uint8Array(padSize(s.length) - s.length)]).flat(),
        ...module.functions.map(h => h.bytecode),
    ];

    parts.push(new Uint8Array(2));

    for (const func of module.functions) {
        if (func.header.overflowed) {
            throw "fish";
        }

        if (func.header.hasExceptionHandler) {
            parts.push(new Uint8Array(new Uint32Array([func.exceptionHandlers.length]).buffer));
            parts.push(new Uint8Array(new Uint32Array(func.exceptionHandlers.flat()).buffer));
        }

        if (func.header.hasDebugInfo) {
            parts.push(new Uint8Array(new Uint32Array(func.debugOffset!).buffer));
        }
    }

    parts.push(
        new Uint8Array(
            module.buffer,
            module.header.debugInfoOffset,
            module.header.fileLength - module.header.debugInfoOffset, // - 20 (file ends with hash)
        ),
    );

    const size = parts.reduce((acc, x) => acc + x.byteLength, 0);

    // module.header.fileLength = size;

    dumpHeader(module.header, parts[0]);

    const data = new Uint8Array(size);

    let i = 0;
    for (const part of parts) {
        data.set(part, i);
        i += part.byteLength;
    }

    return data;
}
