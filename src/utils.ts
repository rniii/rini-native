export function fromEntries<K extends string | number | symbol, V>(entries: Iterable<readonly [K, V]>) {
  return Object.fromEntries(entries) as Record<K, V>;
}

export function entries<K extends string | number | symbol, V>(obj: { [key in K]?: V }) {
  return Object.entries(obj) as [K, V][];
}

export function parseBitfield<K extends string>(buffer: Buffer, fields: Record<K, number>) {
  const parsed = fromEntries(entries(fields).map(([field]) => [field, 0]));

  const cursor = { byte: 0, bit: 0 };
  for (const [field, bitSize] of entries(fields)) {
    let bitsToRead = bitSize;

    while (bitsToRead > 0) {
      const segmentSize = Math.min(bitsToRead, 8 - cursor.bit);
      let mask = (1 << segmentSize) - 1;
      mask <<= cursor.bit;

      let segment = buffer[cursor.byte] & mask;
      segment >>= cursor.bit;
      segment <<= bitsToRead - segmentSize;

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
