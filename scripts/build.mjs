import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist",{recursive:true,force:true});
execFileSync(process.execPath,["node_modules/typescript/bin/tsc","-p","tsconfig.server.json"],{stdio:"inherit"});
execFileSync(process.execPath,["node_modules/vite/bin/vite.js","build"],{stdio:"inherit"});
