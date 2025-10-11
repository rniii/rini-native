// Boehm, Atkinson, and Plass, "Ropes: An Alternative to Strings"
// <https://www.cs.tufts.edu/comp/150FP/archive/hans-boehm/ropes.pdf>

import type util from "util";

import { inspectCustom } from "../../utils/index.ts";

// hack because otherwise you get Rope<"literal"> and can't do anything with it
// eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
type Sequence = String | NodeJS.TypedArray;

export abstract class Rope<S extends Sequence> {
    abstract readonly depth: number;
    abstract readonly length: number;

    abstract slice(start?: number, end?: number): Rope<S>;
    abstract leaves(): Generator<S>;

    static from<S extends Sequence>(value: S) {
        return new Leaf(value) as Rope<S>;
    }

    concat(right: Rope<S>): Rope<S> {
        if (right.length === 0) return this;
        if (this.length === 0) return right;

        return new Concat(this, right);
    }

    replace(start: number, end: number, value: Rope<S>) {
        const left = this.slice(0, start);
        const right = this.slice(end < start ? start : end);

        return left.concat(value).concat(right);
    }

    insert(index: number, value: Rope<S>) {
        const left = this.slice(0, index);
        const right = this.slice(index);

        return left.concat(value).concat(right);
    }

    remove(start: number, end: number) {
        const left = this.slice(0, start);
        const right = this.slice(end < start ? start : end);

        return left.concat(right);
    }

    append(value: Rope<S>) {
        return this.concat(value);
    }

    [inspectCustom](_depth: number, opts: util.InspectOptionsStylized, inspect: typeof util.inspect) {
        let repr = "";

        for (const rope of this.nodes()) {
            if (rope instanceof Concat) repr += opts.stylize("< ", "special");
            else if (rope instanceof Leaf) repr += inspect(rope.value, opts) + " ";
            else repr += inspect(rope, opts);
        }

        return `Rope [ ${repr}]`;
    }

    *nodes(): Generator<Rope<S>> {
        yield this;
    }
}

class Leaf<S extends Sequence> extends Rope<S> {
    depth = 0;
    length: number;

    constructor(public value: S) {
        super();
        this.length = value.length;
    }

    slice(start?: number, end?: number): Rope<S> {
        return Rope.from(
            ArrayBuffer.isView(this.value)
                ? this.value.subarray(start, end)
                : this.value.slice(start, end),
        ) as Rope<S>;
    }

    *leaves(): Generator<S> {
        yield this.value;
    }
}

class Concat<S extends Sequence> extends Rope<S> {
    depth: number;
    length: number;

    constructor(readonly left: Rope<S>, readonly right: Rope<S>) {
        super();
        this.depth = 1 + Math.max(left.depth, right.depth);
        this.length = left.length + right.length;
    }

    slice(start = 0, end = this.length): Rope<S> {
        if (start < 0) start = Math.max(0, start + this.length);
        if (end < 0) end = Math.max(0, end + this.length);

        const rope1 = this.left, rope2 = this.right;

        const left = start <= 0 && end >= rope1.length + start
            ? rope1
            : rope1.slice(start, end);

        const right = start <= rope1.length && end >= rope1.length + rope2.length
            ? rope2
            : rope2.slice(start - rope1.length, end - rope1.length - left.length);

        return left.concat(right);
    }

    *leaves(): Generator<S> {
        yield* this.left.leaves();
        yield* this.right.leaves();
    }

    *nodes(): Generator<Rope<S>> {
        yield this;
        yield* this.left.nodes();
        yield* this.right.nodes();
    }
}
