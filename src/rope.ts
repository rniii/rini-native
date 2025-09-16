// Boehm, Atkinson, and Plass, "Ropes: An Alternative to Strings"
// <https://www.cs.tufts.edu/comp/150FP/archive/hans-boehm/ropes.pdf>

type Sequence = String | any[] | NodeJS.TypedArray;

export class Rope<S extends Sequence> {
    _value?: S;
    _concat?: [Rope<S>, Rope<S>];

    length: number;

    constructor(seq: S) {
        this._value = seq;
        this.length = seq.length;
    }

    concat(right: Rope<S>) {
        if (right.length === 0) return this;
        if (this.length === 0) return right;

        return Object.setPrototypeOf({
            _concat: [this, right],
            length: this.length + right.length,
        }, Rope.prototype) as Rope<S>;
    }

    insert(index: number, value: Rope<S>) {
        const left = this.slice(0, index);
        const right = this.slice(index);

        return left.concat(value).concat(right);
    }

    remove(index: number, count = 1) {
        const left = this.slice(0, index);
        const right = this.slice(index + count);

        return left.concat(right);
    }

    append(value: Rope<S>) {
        return this.concat(value);
    }

    slice(start = 0, end = this.length): Rope<S> {
        if (this._value) {
            return new Rope(
                ArrayBuffer.isView(this._value)
                    ? this._value.subarray(start, end) as S
                    : this._value.slice(start, end) as S,
            );
        }

        if (start < 0) start = Math.max(0, start + this.length);
        if (end < 0) end = Math.max(0, end + this.length);

        const [rope1, rope2] = this._concat!;

        const left = start <= 0 && end >= rope1.length + start
            ? rope1
            : rope1.slice(start, end);

        const right = start <= rope1.length && end >= rope1.length + rope2.length
            ? rope2
            : rope2.slice(start - rope1.length, end - rope1.length - left.length);

        return left.concat(right);
    }

    *leaves(): Generator<S> {
        if (this._concat) {
            yield* this._concat[0].leaves();
            yield* this._concat[1].leaves();
        } else {
            yield this._value!;
        }
    }

    *[Symbol.iterator](): Generator<S extends Iterable<infer T> ? T : never> {
        if (this._concat) {
            yield* this._concat[0];
            yield* this._concat[1];
        } else {
            yield* this._value!;
        }
    }
}
