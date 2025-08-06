import type { CustomInspectFunction } from "node:util";
import { entries, fromEntries, hasOwn, padSize } from "../../utils";

const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

export type BitfieldSegment = {
  size: number;
  mask: number;
  cursor: { byte: number; bit: number };
  shift: number;
};

export class Bitfield<K extends string> {
  bitSize: number;
  byteSize: number;

  segments: Record<K, BitfieldSegment[]>;

  constructor(public fields: Record<K, number>) {
    this.bitSize = entries(this.fields).reduce((a, [, b]) => a + b, 0);
    this.byteSize = padSize(Math.ceil(this.bitSize / 8));

    this.segments = fromEntries(entries(this.fields).map(([field]) => [field, []]));

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

        this.segments[field].push({
          cursor: { ...cursor },
          mask,
          size: segmentSize,
          shift: bitSize - bitsToRead,
        });

        cursor.bit += segmentSize;
        bitsToRead -= segmentSize;
        if (cursor.bit === 8) {
          cursor.bit = 0;
          cursor.byte++;
        }
      }
    }
  }

  parseField(buffer: Buffer, field: K) {
    let value = 0;
    for (const { cursor, mask, shift } of this.segments[field]) {
      value |= ((buffer[cursor.byte] & mask) >> cursor.bit) << shift;
    }
    return value;
  }

  createLazyParser(buffer: Buffer) {
    const cached: Partial<Record<K, number>> = {};

    const uncomputedInspect: CustomInspectFunction = (depth, options) => options.stylize("(uncomputed)", "undefined");
    const lazyInpsect: CustomInspectFunction = (depth, options) => {
      if (depth < 0) return options.stylize("[Bitfield]", "special");
      const UNCOMPUTED_VALUE = { [inspectCustom]: uncomputedInspect };
      return fromEntries(
        entries(this.fields).map(([field]) => [field, hasOwn(cached, field) ? cached[field] : UNCOMPUTED_VALUE]),
      );
    };

    // @ts-expect-error
    cached[inspectCustom] = lazyInpsect;

    return new Proxy(cached, {
      get: (target, prop) => {
        if (!hasOwn(this.fields, prop)) return undefined;
        if (target[prop] != null) return target[prop];

        return target[prop] = this.parseField(buffer, prop);
      },
      ownKeys: () => Object.keys(this.fields),
      has: (target, prop) => Object.hasOwn(this.fields, prop),
      getOwnPropertyDescriptor: (target, prop) => {
        if (!hasOwn(this.fields, prop)) return undefined;
        if (target[prop] == null) target[prop] = this.parseField(buffer, prop);
        return Reflect.getOwnPropertyDescriptor(cached, prop);
      },
    }) as Record<K, number>;
  }

  parse(buffer: Buffer, lazy = true) {
    if (lazy) return this.createLazyParser(buffer);

    return fromEntries(entries(this.fields).map(([field]) => [field, this.parseField(buffer, field)]));
  }

  parseElement(buffer: Buffer, index: number, lazy = true) {
    return this.parse(buffer.subarray(index * this.byteSize, (index + 1) * this.byteSize), lazy);
  }
}

export type ParsedBitfield<T extends Bitfield<string>> = T["fields"];
