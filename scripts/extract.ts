import { execFileSync } from "child_process";
import { unzip } from "fflate";
import { readFileSync, writeFileSync } from "fs";
import { basename } from "path";

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

const ANDROID_BUNDLE = "assets/index.android.bundle";

unzip(
    readFileSync("discord/base.apk"),
    { filter: (file) => file.name === ANDROID_BUNDLE },
    (err, data) => {
        if (err) throw err;

        writeFileSync("discord/bundle.hbc", data[ANDROID_BUNDLE]);
    },
);

function $(exe: string, ...args: string[]) {
    console.log(`$ ${exe} ${args.join(" ")}`);
    return execFileSync(exe, args, { encoding: "utf8" });
}
