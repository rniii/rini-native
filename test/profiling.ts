import { writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";

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

export async function measureProfile(outFile: string) {
	const session = new Session();
	session.connect();

	await session.post("Profiler.enable");
	await session.post("Profiler.start");

	return {
		async [Symbol.asyncDispose]() {
			const { profile } = await session.post("Profiler.stop");
			await writeFile(outFile, JSON.stringify(profile));
		},
	};
}
