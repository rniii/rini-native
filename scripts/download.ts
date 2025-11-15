import { createWriteStream } from "fs";
import { Readable } from "stream";

let bundleUrl: string;
let latestVersion = (await (await fetch("https://tracker.vendetta.rocks/tracker/index")).json()).latest.stable;

if (!process.argv.includes("ios")) {
    const majVer = Math.floor(latestVersion / 1000);
    const minVer = latestVersion % 100;
    const commitHash = (await (await fetch(`https://discord.com/android/${majVer}.${minVer}/manifest.json`)).json()).metadata.commit;
    bundleUrl = `https://discord.com/assets/android/${commitHash}/app/src/main/assets/index.android.bundle`;
} else {
    latestVersion = latestVersion.toString().replace(/(\d{3})(\d)\d{2}/, (match: string, p1: string, p2: string) => `${p1}.${p2}`);
    const commitHash = (await (await fetch(`https://discord.com/ios/${latestVersion}/manifest.json`)).json()).metadata.commit;
    bundleUrl = `https://discord.com/assets/ios/${commitHash}/main.jsbundle`;
}

console.log(`Downloading from ${bundleUrl}...`);

const resp = await fetch(bundleUrl);
if (!resp.body) throw new Error(`Download ${bundleUrl}: response body is empty`);

const body = Readable.fromWeb(resp.body as any);
body.pipe(createWriteStream("discord/bundle.hbc"));