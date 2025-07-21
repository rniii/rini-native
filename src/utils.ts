export function fromEntries<K extends string | number | symbol, V>(entries: Iterable<readonly [K, V]>) {
  return Object.fromEntries(entries) as Record<K, V>;
}

export function entries<K extends string | number | symbol, V>(obj: { [key in K]?: V }) {
  return Object.entries(obj) as [K, V][];
}

export function hasOwn<O extends object>(obj: O, key: string | number | symbol): key is keyof O {
  return Object.hasOwn(obj, key);
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
export function toBigInt(buffer: Buffer) {
  let bigint = 0n;
  for (let i = 0; i < buffer.length; i++) bigint |= BigInt(buffer[i]) << BigInt(buffer.length - i - 1);
  return bigint;
}

const instrumentedFuncs = {} as any;
process.on("exit", () => {
  if (!Object.keys(instrumentedFuncs).length) return;

  console.table(instrumentedFuncs);
});

export function instrument<F extends (...args: any[]) => any>(name: string, func: F) {
  let accTime = 0;
  let avgTime = 0;
  let maxTime = 0;
  let prevTime = 0;
  let calls = 0;

  process.on("beforeExit", () => {
    instrumentedFuncs[name] = { accTime, avgTime, maxTime, calls };
  });

  return (...args: Parameters<F>) => {
    const start = performance.now();
    const res = func(...args);

    const dt = performance.now() - start;

    avgTime += 1 / ++calls * (dt - prevTime);
    accTime += prevTime = dt;
    maxTime = Math.max(dt, maxTime);

    return res;
  };
}
