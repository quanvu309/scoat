import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export type RecoveryReason =
 | "usage"
 | "environment"
 | "connection-parameter"
 | "pg-bin-required"
 | "pg-tool-missing"
 | "pg-tool-version"
 | "pg-tool-too-old"
 | "archive-exists"
 | "target-not-fresh"
 | "same-database"
 | "source-not-sealed"
 | "consumed"
 | "archive-not-sealed"
 | "pg-dump-failed"
 | "pg-restore-failed"
 | "migration-failed";
export type Detail = Readonly<Record<string, string | number>>;

export class RecoveryRefused extends Error {
 constructor(readonly reason: RecoveryReason, readonly detail: Detail = {}) { super("Recovery refused: " + reason); }
}

export type PgTools = Readonly<{ dump: string; restore: string; major: number; library: string | null }>;
export type Connection = Readonly<{ dbname: string; password: string | null }>;

const run = promisify(execFile);
const libpqParameters = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey", "sslcrl", "host", "port", "connect_timeout", "application_name", "target_session_attrs"]);
const versionPattern = /^(pg_dump|pg_restore) \(PostgreSQL\) ([1-9][0-9]{1,2})(\.[0-9]+)?(\s|$)/;

export function bounded(text: string): string {
 return text.replace(/postgres(ql)?:\/\/\S*/gi, "<connection>").replace(/password\s*=\s*\S+/gi, "password=<redacted>").slice(-400);
}

export function libpqConnection(url: string): Connection {
 let parsed: URL;
 try { parsed = new URL(url); } catch { throw new RecoveryRefused("connection-parameter", { parameter: "url" }); }
 if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new RecoveryRefused("connection-parameter", { parameter: "protocol" });
 const password = parsed.password === "" ? null : decodeURIComponent(parsed.password);
 parsed.password = "";
 for (const key of [...parsed.searchParams.keys()]) {
  if (key === "options") parsed.searchParams.delete(key);
  else if (!libpqParameters.has(key)) throw new RecoveryRefused("connection-parameter", { parameter: key.slice(0, 40) });
 }
 return { dbname: parsed.href, password };
}

export function toolMajor(name: "pg_dump" | "pg_restore", output: string): number {
 const match = versionPattern.exec(output.trim());
 if (!match || match[1] !== name || match[2] === undefined) throw new RecoveryRefused("pg-tool-version", { tool: name });
 return Number(match[2]);
}

export function requireMajor(tools: PgTools, serverMajor: number): void {
 if (tools.major < serverMajor) throw new RecoveryRefused("pg-tool-too-old", { client: tools.major, server: serverMajor });
}

function toolEnvironment(library: string | null, password: string | null): Record<string, string> {
 const environment: Record<string, string> = { PATH: "/usr/bin:/bin", PGAPPNAME: "scoat-recovery", PGCONNECT_TIMEOUT: "10" };
 for (const [key, value] of Object.entries(process.env)) if (/^PGSSL[A-Z]+$/.test(key) && value !== undefined) environment[key] = value;
 if (library !== null) environment.LD_LIBRARY_PATH = library;
 if (password !== null) environment.PGPASSWORD = password;
 return environment;
}

function failure(error: unknown): Detail {
 const exit = error instanceof Error && "code" in error && (typeof error.code === "number" || typeof error.code === "string") ? error.code : "unknown";
 const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
 return { exit, stderr: bounded(stderr) };
}

export async function resolvePgTools(environment: Readonly<Record<string, string | undefined>>): Promise<PgTools> {
 const bin = environment.SCOAT_PG_BIN, library = environment.SCOAT_PG_LIB ?? null;
 if (bin === undefined || !path.isAbsolute(bin) || (library !== null && !path.isAbsolute(library))) throw new RecoveryRefused("pg-bin-required");
 const dump = path.join(bin, "pg_dump"), restore = path.join(bin, "pg_restore");
 const majors: number[] = [];
 for (const [name, file] of [["pg_dump", dump], ["pg_restore", restore]] as const) {
  try { await access(file, constants.X_OK); } catch { throw new RecoveryRefused("pg-tool-missing", { tool: name }); }
  let output: string;
  try { output = (await run(file, ["--version"], { env: toolEnvironment(library, null), timeout: 10000, shell: false })).stdout; } catch (error) { throw new RecoveryRefused("pg-tool-version", { tool: name, ...failure(error) }); }
  majors.push(toolMajor(name, output));
 }
 const [dumpMajor, restoreMajor] = majors;
 if (dumpMajor === undefined || dumpMajor !== restoreMajor) throw new RecoveryRefused("pg-tool-version", { tool: "pg_dump/pg_restore" });
 return { dump, restore, major: dumpMajor, library };
}

export async function runTool(tools: PgTools, tool: "dump" | "restore", args: readonly string[], password: string | null): Promise<void> {
 try {
  await run(tool === "dump" ? tools.dump : tools.restore, [...args], { env: toolEnvironment(tools.library, password), timeout: 3600000, maxBuffer: 1 << 22, shell: false });
 } catch (error) {
  throw new RecoveryRefused(tool === "dump" ? "pg-dump-failed" : "pg-restore-failed", failure(error));
 }
}
