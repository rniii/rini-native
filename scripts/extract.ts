import { execFileSync } from "child_process";
import { unzip } from "fflate";
import { readFileSync, writeFileSync } from "fs";
import { basename } from "path";

let base;
let bundle;

if (!process.argv.includes("ios")) {
    base = "discord/base.apk";
    bundle = "assets/index.android.bundle";
    if (!process.argv.includes("--no-pull")) {
        $("adb", "wait-for-device");

        const packages = $("adb", "shell", "pm path com.discord")
            .replaceAll(/^package:/gm, "")
            .split("\n")
            .filter(name => /base\.apk$|split_config\.(arm.*|x86.*|xxhdpi|en)\.apk$/.test(name));

        for (const pkg of packages) {
            $("adb", "pull", pkg, `discord/${basename(pkg)}`);
        }
    }
} else {
    base = "discord/base.ipa";
    bundle = "Payload/Discord.app/main.jsbundle";
    if (!process.argv.includes("--no-pull")) {
        $("ipatool", "download", "-b", "com.hammerandchisel.Discord", "-o", base, "--purchase");
    }
}

unzip(
    readFileSync(base),
    { filter: file => file.name === bundle },
    (err, data) => {
        if (err) throw err;

        writeFileSync("discord/bundle.hbc", data[bundle]);
    },
);

function $(exe: string, ...args: string[]) {
    console.log(`$ ${exe} ${args.join(" ")}`);
    return execFileSync(exe, args, { encoding: "utf8" });
}
