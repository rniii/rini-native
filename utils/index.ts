export function fromEntries<K extends string | number | symbol, V>(entries: Iterable<readonly [K, V]>) {
  return Object.fromEntries(entries) as Record<K, V>;
}

export function entries<K extends string | number | symbol, V>(obj: { [key in K]?: V }) {
  return Object.entries(obj) as [K, V][];
}

export function hasOwn<O extends object>(obj: O, key: string | number | symbol): key is keyof O {
  return Object.hasOwn(obj, key);
}

export function mapValues<K extends keyof any, V, W>(obj: { [key in K]?: V }, func: (v: V) => W) {
  return fromEntries(entries(obj).map(([k, v]) => [k, func(v)]));
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
  for (let i = 0; i < buffer.length; i++) bigint |= BigInt(buffer[i]) << BigInt(buffer.length - i - 1);
  return bigint;
}

export function dedent(text: TemplateStringsArray, ...values: any[]) {
  const string = String.raw({ raw: text }, ...values);
  const [indent] = string.match(/^ */)!;

  return string.replaceAll(new RegExp(`^${indent}`, "gm"), "");
}

export function formatSizeUnit(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB"];

  while (bytes > 1024 && units.length > 1) {
    bytes /= 1024;
    units.shift();
  }

  bytes = (+bytes.toPrecision(3) * 100 | 0) / 100;

  return bytes + units.shift()!;
}

/** A version of {@link DataView} that defaults to little-endian */
export class DataViewLE extends DataView {
  static {
    const DATAVIEW_METHODS = [
      "BigUint64",
      "BigInt64",
      "Uint32",
      "Int32",
      "Uint16",
      "Int16",
      "Float64",
      "Float32",
    ] as const;

    for (const method of DATAVIEW_METHODS) {
      Object.assign(this.prototype, {
        [`get${method}`](byteOffset: number, littleEndian = true) {
          // @ts-expect-error dumb
          return DataView.prototype[`get${method}`].call(this, byteOffset, littleEndian) as any;
        },
        [`set${method}`](byteOffset: number, value: any, littleEndian = true) {
          DataView.prototype[`set${method}`].call(this, byteOffset, value, littleEndian);
        },
      });
    }
  }
}
