import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist",{recursive:true,force:true});
execFileSync(process.execPath,["node_modules/typescript/bin/tsc","-p","tsconfig.server.json"],{stdio:"inherit"});
execFileSync(process.execPath,["node_modules/vite/bin/vite.js","build"],{stdio:"inherit"});
const { recordRelease } = await import("../dist/release.js");
process.stdout.write(JSON.stringify({ release: await recordRelease() }) + "\n");
