import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
export async function memoryEvidence(kind) {
 const root = process.env.SCOAT_EVIDENCE_DIR ?? path.join(os.homedir(),"tmp/scoat-delivery/p06",kind+"-"+Date.now());
 await fs.mkdir(root,{recursive:true});
 const git = (...args) => execFileSync("git",args,{encoding:"utf8",maxBuffer:1000000}).trim();
 const baseline = {head:git("rev-parse","origin/main"),memory:"UNAVAILABLE: trunk has no Memory implementation or authenticated HTTP server",sharedOperation:"UNAVAILABLE: trunk is unimplemented; no like-for-like runtime",ratio:null};
 await fs.writeFile(path.join(root,"trunk-memory.txt"),git("show","origin/main:src/memory/index.ts"));
 await fs.writeFile(path.join(root,"baseline.json"),JSON.stringify(baseline,null,2));
 const identity = {head:git("rev-parse","HEAD"),base:"ba11ec54ad9b6d0a4541c93451055798bbb7df47",worktreeStatus:git("status","--porcelain"),node:process.version,platform:os.platform(),release:os.release(),architecture:os.arch(),cpus:os.cpus().length,cpu:os.cpus()[0]?.model,memory:os.totalmem(),load:os.loadavg()};
 return {root,identity,baseline,save:async(name,value)=>fs.writeFile(path.join(root,name),JSON.stringify(value,null,2))};
}
