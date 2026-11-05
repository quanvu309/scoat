import { rm, cp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist",{recursive:true,force:true});
execFileSync(process.execPath,["node_modules/typescript/bin/tsc","-p","tsconfig.server.json"],{stdio:"inherit"});
execFileSync(process.execPath,["node_modules/vite/bin/vite.js","build"],{stdio:"inherit"});
let theme = await readFile("landing/public/ui.css", "utf8");
for (const match of theme.matchAll(/url\("\/fonts\/([^"]+)"\)/g)) {
 const font = await readFile("landing/public/fonts/" + match[1]);
 theme = theme.replace(match[0], `url("data:font/woff2;base64,${font.toString("base64")}")`);
}
await writeFile("dist/browser/ui.css", theme);
await cp("landing/public/account.css", "dist/browser/account.css");
await cp("landing/public/favicon.svg", "dist/browser/brand.svg");
const { recordRelease } = await import("../dist/release.js");
process.stdout.write(JSON.stringify({ release: await recordRelease() }) + "\n");
