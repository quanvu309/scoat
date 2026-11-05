import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { devNull } from "node:os";

const exec = promisify(execFile);
const sha = async file => createHash("sha256").update(await readFile(file)).digest("hex");

export function postgresClientTools() {
 const bin = process.env.SCOAT_PG_BIN, lib = process.env.SCOAT_PG_LIB;
 if (!bin || !path.isAbsolute(bin)) throw new Error("Set SCOAT_PG_BIN to the absolute bin directory of PostgreSQL client tools whose major is at least the server major");
 if (lib !== undefined && !path.isAbsolute(lib)) throw new Error("SCOAT_PG_LIB must be an absolute directory when set");
 const runtime = lib === undefined ? {} : { LD_LIBRARY_PATH: lib };
 return { bin, cliEnv: { SCOAT_PG_BIN: bin, ...(lib === undefined ? {} : { SCOAT_PG_LIB: lib }) }, env: { PATH: process.env.PATH, ...runtime } };
}

export async function baseArtifact(checkout, scratch, revision) {
 const base = path.join(scratch, "base-" + revision);
 await mkdir(base);
 await exec("git", ["archive", "--output=" + base + ".tar", revision], { cwd: checkout });
 await exec("tar", ["-xf", base + ".tar", "-C", base]);
 const lockfile = await sha(path.join(base, "package-lock.json"));
 let dependencies;
 if (process.env.SCOAT_BASE_APP) {
  if (await sha(path.join(process.env.SCOAT_BASE_APP, "package-lock.json")) !== lockfile) throw new Error("SCOAT_BASE_APP lockfile differs from the base revision");
  await symlink(path.join(process.env.SCOAT_BASE_APP, "node_modules"), path.join(base, "node_modules"));
  dependencies = "SCOAT_BASE_APP override with a lockfile identical to " + revision;
 } else if (await sha(path.join(checkout, "package-lock.json")) === lockfile) {
  await symlink(path.join(checkout, "node_modules"), path.join(base, "node_modules"));
  dependencies = "checkout node_modules installed from a lockfile identical to " + revision;
 } else {
  const installEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
  await exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--userconfig=" + devNull], { cwd: base, env: installEnv, timeout: 600000, maxBuffer: 1 << 24 });
  dependencies = "npm ci of the " + revision + " lockfile inside task scratch";
 }
 await exec(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"], { cwd: base, timeout: 300000, maxBuffer: 1 << 24 });
 return { path: base, lockfileSha256: lockfile, label: "base artifact: git archive " + revision + " compiled with tsc in task scratch " + base + "; dependencies: " + dependencies };
}
