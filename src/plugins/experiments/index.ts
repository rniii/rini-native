import { Opcode } from "decompiler/opcodes";

import { definePlugin } from "#api/plugin.ts";

export default definePlugin({
    name: "Experiments",
    authors: ["rini"],

    patches: [
        {
            strings: ["Object", "defineProperties", "isDeveloper"],
            patches: {
                identifier: "get",
                replace: [
                    [Opcode.LoadConstTrue, 0],
                    [Opcode.Ret, 0],
                ],
            },
        },
        {
            identifier: "handleLoadedExperiments",
            strings: ["EXPERIMENTS_FETCH_SUCCESS", "ready_payload"],
            apply(f) {
                const [loadEnv] = f.match(
                    [Opcode.LoadFromEnvironment, null, null, null],
                    [Opcode.Not, null, null],
                    [Opcode.JmpTrue, null, null],
                    [Opcode.GetById, null, null, null, "type"],
                    [Opcode.LoadConstString, null, "CONNECTION_OPEN"],
                );

                f.replaceOne(loadEnv, [
                    [Opcode.LoadConstTrue, loadEnv.args[0]],
                    [Opcode.StoreNPToEnvironment, loadEnv.args[1], loadEnv.args[2], loadEnv.args[0]],
                ]);
            },
        },
    ],
});
