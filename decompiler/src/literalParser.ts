import type { StringTable } from "./module.ts";

export type Literal = number | string | boolean | null;

enum TagType {
    Null = 0,
    True = 1,
    False = 2,
    Number = 3,
    LongString = 4,
    ShortString = 5,
    ByteString = 6,
    Integer = 7,
}

// XXX: ideally all literals should be parsed ahead of time, but it doesn't seem to be trivial
// (trying to read everything in `module.arrayBuffer` fails after 3 tags)

export function parseLiterals(buffer: Uint8Array, offset: number, count: number, strings: StringTable) {
    const literals: Literal[] = [];

    const view = new DataView(buffer.buffer, buffer.byteOffset);

    while (literals.length < count) {
        const byte = buffer[offset++];

        // 0tagllll or 1tagllll llllllll
        // 76543210    76543210 76543210
        const tag: TagType = (byte >> 4) & 0b111;
        let len = byte & 0b1111;

        if (byte & 0x80) len = len << 8 | buffer[offset++];

        for (let i = 0; i < len; i++) {
            switch (tag) {
                case TagType.Null:
                    literals.push(null);
                    continue;
                case TagType.True:
                    literals.push(true);
                    continue;
                case TagType.False:
                    literals.push(false);
                    continue;
                case TagType.Number:
                    literals.push(view.getFloat64(offset, true));
                    offset += 8;
                    continue;
                case TagType.LongString:
                    literals.push(strings.get(view.getUint32(offset, true)));
                    offset += 4;
                    continue;
                case TagType.ShortString:
                    literals.push(strings.get(view.getUint16(offset, true)));
                    offset += 2;
                    continue;
                case TagType.ByteString:
                    literals.push(strings.get(view.getUint8(offset)));
                    offset += 1;
                    continue;
                case TagType.Integer:
                    literals.push(view.getUint32(offset, true));
                    offset += 4;
                    continue;
            }
        }
    }

    return literals;
}
