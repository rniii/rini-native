import type { PatchDef } from "./patches.ts";

type Author = "rini";

interface PluginDef {
    name: string;
    authors: Author[];
    patches: PatchDef[];
}

export function definePlugin(plugin: PluginDef) {
    return plugin;
}
