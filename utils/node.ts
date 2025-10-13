import { open } from "fs/promises";

export async function readArrayBuffer(path: string) {
    await using file = await open(path);

    const stat = await file.stat();
    const buffer = new ArrayBuffer(stat.size);

    await file.read(new Uint8Array(buffer));
    return buffer;
}
