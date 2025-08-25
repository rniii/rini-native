import { entries, padSize } from "../../utils/index.ts";

export class Bitfield<K extends string> {
  bitSize: number;
  byteSize: number;
  #segments: [K, { byte: number; mask: number; shift: number }][];

  constructor(public fields: Record<K, number>) {
    this.bitSize = entries(fields).reduce((a, [, b]) => a + b, 0);
    this.byteSize = padSize(Math.ceil(this.bitSize / 8));

    let bit = 0;
    this.#segments = entries(fields).map(([name, bitSize]) => {
      if (bitSize > 32) throw Error(`Field "${name}" is larger than 32 bits`);
      if (bit % 32 + bitSize > 32) throw Error(`Field "${name}" is misaligned`);

      let byte = (bit / 32 | 0) * 4;
      let shift = bit % 32;
      let mask = -1 >>> (32 - bitSize) | 0; // right shift instead of left so 32-bit mask doesn't overflow
      bit += bitSize;

      return [name, { byte, mask, shift }];
    });
  }

  parse(buffer: Uint8Array) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const value = {} as { [P in K]: number };

    for (const [field, segment] of this.#segments) {
      value[field] = ((view.getInt32(segment.byte, true) >> segment.shift) & segment.mask) >>> 0;
    }

    return value;
  }

  parseArray(buffer: Uint8Array, count: number) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const result = [] as { [P in K]: number }[];

    const step = this.byteSize;
    const end = count * step;

    for (let i = 0; i < end; i += step) {
      const value = {} as { [P in K]: number };

      for (const [field, segment] of this.#segments) {
        value[field] = ((view.getInt32(i + segment.byte, true) >> segment.shift) & segment.mask) >>> 0;
      }

      result.push(value);
    }

    return result;
  }
}

export type ParsedBitfield<T extends Bitfield<string>> = T["fields"];
