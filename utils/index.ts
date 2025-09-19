export function fromEntries<K extends keyof any, V>(entries: Iterable<readonly [K, V]>) {
    return Object.fromEntries(entries) as Record<K, V>;
}

export function entries<K extends keyof any, V>(obj: { [key in K]?: V }) {
    return Object.entries(obj) as [K, V][];
}

export function hasOwn<O extends object>(obj: O, key: keyof any): key is keyof O {
    return Object.hasOwn(obj, key);
}

export function mapValues<K extends keyof any, V, W>(obj: { [key in K]?: V }, func: (v: V) => W) {
    return fromEntries(entries(obj).map(([k, v]) => [k, func(v)]));
}

/** Perform a binary search for a given element, returning the rightmost index. */
export function bisect<T>(arr: T[], value: T, key = (x: T) => x as any) {
    let lo = 0, hi = arr.length;
    value = key(value);

    while (lo < hi) {
        const mid = (lo + hi) / 2 | 0;

        if (key(arr[mid]) <= value) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    return lo;
}

/** Insert an element into an array, keeping it sorted. */
export function insort<T>(arr: T[], value: T, key = (x: T) => x as any) {
    arr.splice(bisect(arr, value, key), 0, value);
}

export function transpose<T>(matrix: T[][]): T[][] {
    const newArray: T[][] = [];
    for (let i = 0; i < matrix[0].length; i++) {
        newArray.push([]);
    }

    for (let y = 0; y < matrix.length; y++) {
        for (let x = 0; x < matrix[0].length; x++) {
            newArray[x].push(matrix[y][x]);
        }
    }

    return newArray;
}

export function padSize(size: number) {
    return Math.ceil(size / 4) * 4;
}

export function lazyPromise<T>(get: () => Promise<T>): PromiseLike<T> {
    let cached: T | undefined;
    return {
        then(resolve, reject) {
            if (cached !== undefined) return Promise.resolve(cached).then(resolve);
            return get().then(value => cached = value).then(resolve, reject);
        },
    };
}

/** Parses buffer as little-endian bigint */
export function toBigInt(buffer: Uint8Array) {
    let bigint = 0n;
    for (let i = 0; i < buffer.length; i++) {
        bigint |= BigInt(buffer[i]) << (BigInt(i) * 8n);
    }
    return bigint;
}

export function dedent(text: TemplateStringsArray, ...values: any[]) {
    const [indent] = text[0].match(/^ */)!;
    const re = new RegExp(`^${indent}`, "gm");

    return String.raw({ raw: text.map(x => x.replace(re, "")) }, ...values);
}

export function formatSizeUnit(bytes: number) {
    const units = ["B", "KiB", "MiB", "GiB"];

    while (bytes > 1024 && units.length > 1) {
        bytes /= 1024;
        units.shift();
    }

    bytes = Math.floor(+bytes.toPrecision(3) * 100) / 100;

    return bytes + units.shift()!;
}

export const inspectCustom = Symbol.for("nodejs.util.inspect.custom")
