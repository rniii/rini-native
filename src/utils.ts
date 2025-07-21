export function fromEntries<K extends string | number | symbol, V>(entries: Iterable<readonly [K, V]>) {
  return Object.fromEntries(entries) as Record<K, V>;
}

export function entries<K extends string | number | symbol, V>(obj: { [key in K]?: V }) {
  return Object.entries(obj) as [K, V][];
}

export function padSize(size: number) {
  return Math.ceil(size / 4) * 4;
}

export function createBitfieldParser<K extends string>(fields: Record<K, number>) {
  const bitSize = entries(fields).reduce((a, [, b]) => a + b, 0);
  const byteSize = Math.ceil(bitSize / 8);

  return {
    size: byteSize,
    parse: (buffer: Buffer) => parseBitfield(buffer, fields),
    parseElement: (buffer: Buffer, idx: number) =>
      parseBitfield(buffer.subarray(idx * byteSize, (idx + 1) * byteSize), fields),
  };
}

export function parseBitfield<K extends string>(buffer: Buffer, fields: Record<K, number>) {
  const parsed = fromEntries(entries(fields).map(([field]) => [field, 0]));

  const cursor = { byte: 0, bit: 0 };
  for (const [field, bitSize] of entries(fields)) {
    if (bitSize > Math.log2(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`bitSize for "${field}" exceeds MAX_SAFE_INTEGER`);
    }
    let bitsToRead = bitSize;

    while (bitsToRead > 0) {
      const segmentSize = Math.min(bitsToRead, 8 - cursor.bit);
      let mask = (1 << segmentSize) - 1;
      mask <<= cursor.bit;

      let segment = buffer[cursor.byte] & mask;
      segment >>= cursor.bit;
      segment <<= bitSize - bitsToRead;

      parsed[field] |= segment;
      cursor.bit += segmentSize;
      bitsToRead -= segmentSize;
      if (cursor.bit === 8) {
        cursor.bit = 0;
        cursor.byte++;
      }
    }
  }

  return parsed;
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
export function toBigInt(buffer: Buffer) {
  let bigint = 0n;
  for (let i = 0; i < buffer.length; i++) bigint |= BigInt(buffer[i]) << BigInt(buffer.length - i - 1);
  return bigint;
}
