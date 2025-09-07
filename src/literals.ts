import { Bitfield } from "@/Bitfield";

export const enum TagType {
    Null = 0,
    True = 1,
    False = 2,
    Number = 3,
    LongString = 4,
    ShortString = 5,
    ByteString = 6,
    Integer = 7,
}

export const tagByte = new Bitfield({
    isLarge: 1,
    type: 3,
    length: 4,
});

export const literalParsers = {
    [TagType.Null]: new Bitfield({ value: 0 }),
    [TagType.True]: new Bitfield({ value: 0 }),
    [TagType.False]: new Bitfield({ value: 0 }),
    [TagType.Number]: new Bitfield({ value: 8 }),
    [TagType.LongString]: new Bitfield({ value: 4 }),
    [TagType.ShortString]: new Bitfield({ value: 2 }),
    [TagType.ByteString]: new Bitfield({ value: 1 }),
    [TagType.Integer]: new Bitfield({ value: 4 }),
} satisfies Record<TagType, any>;

export type Literal = { type: TagType; value: number };
export function parseLiterals(buffer: Buffer, offset: number, count: number) {
    const literals: Literal[] = [];

    while (literals.length < count) {
        let tag = tagByte.parse(buffer.subarray(offset++, offset));
        if (tag.isLarge) tag.length |= buffer[offset++] << 4;
        const type: TagType = tag.type;

        const parser = literalParsers[type];
        for (let i = 0; i < tag.length && literals.length < count; i++) {
            const { value } = parser.parse(buffer.subarray(offset, offset += parser.byteSize));
            literals.push({ type, value });
        }
    }

    return literals;
}
