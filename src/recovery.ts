import type pg from "pg";
import { openPool } from "./db/pool.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { inspect, LineageRefused, seal, unseal } from "./db/lineage.js";
import { admitTarget, restore } from "./recovery/handoff.js";
import { bounded, RecoveryRefused, resolvePgTools } from "./recovery/tools.js";

type Environment = Readonly<Record<string, string | undefined>>;

const commandSchema = z.discriminatedUnion("command", [
 z.strictObject({ command: z.literal("status") }),
 z.strictObject({ command: z.literal("seal") }),
 z.strictObject({ command: z.literal("unseal"), seal: z.uuid() }),
 z.strictObject({ command: z.literal("restore"), archive: z.string().min(2).max(4096).refine(value => path.isAbsolute(value)) }),
 z.strictObject({ command: z.literal("admit") }),
]);
export type RecoveryCommand = z.infer<typeof commandSchema>;

export function parseCommand(argv: readonly string[]): RecoveryCommand {
 const tokens = (() => {
  try {
   return parseArgs({ args: [...argv], options: { seal: { type: "string" }, archive: { type: "string" } }, strict: true, allowPositionals: true });
  } catch {
   throw new RecoveryRefused("usage");
  }
 })();
 const [command, ...extra] = tokens.positionals;
 const result = commandSchema.safeParse({ command, ...tokens.values });
 if (extra.length || !result.success) throw new RecoveryRefused("usage");
 return result.data;
}

function required(environment: Environment, name: "DATABASE_URL" | "SCOAT_SOURCE_DATABASE_URL" | "SCOAT_TARGET_DATABASE_URL"): string {
 const value = environment[name];
 if (value === undefined || value.length === 0 || value.length > 4096) throw new RecoveryRefused("environment", { name });
 return value;
}

function connect(connectionString: string): pg.Pool {
 const pool = openPool({ connectionString, max: 2, connectionTimeoutMillis: 10000 });
 return pool;
}

async function withPool<T>(url: string, run: (pool: pg.Pool) => Promise<T>): Promise<T> {
 const pool = connect(url);
 try { return await run(pool); } finally { await pool.end(); }
}

async function withPair<T>(sourceUrl: string, targetUrl: string, run: (source: pg.Pool, target: pg.Pool) => Promise<T>): Promise<T> {
 const source = connect(sourceUrl), target = connect(targetUrl);
 try { return await run(source, target); } finally { await Promise.all([source.end(), target.end()]); }
}

async function execute(command: RecoveryCommand, environment: Environment): Promise<Readonly<Record<string, unknown>>> {
 if (command.command === "status") return withPool(required(environment, "DATABASE_URL"), async pool => {
  const state = await inspect(pool);
  if (state.kind === "unadmitted") return { command: "status", state: state.kind, reason: state.reason };
  if (state.kind === "admitted") return { command: "status", state: state.kind };
  return { command: "status", state: state.kind, sealId: state.sealId, consumedBy: state.consumedBy };
 });
 if (command.command === "seal") return withPool(required(environment, "DATABASE_URL"), async pool => ({ command: "seal", sealId: (await seal(pool)).sealId }));
 if (command.command === "unseal") return withPool(required(environment, "DATABASE_URL"), async pool => ({ command: "unseal", result: await unseal(pool, command.seal) }));
 const sourceUrl = required(environment, "SCOAT_SOURCE_DATABASE_URL"), targetUrl = required(environment, "SCOAT_TARGET_DATABASE_URL");
 if (command.command === "restore") {
  const tools = await resolvePgTools(environment);
  return withPair(sourceUrl, targetUrl, async (source, target) => ({ command: "restore", ...await restore({ source, sourceUrl, target, targetUrl, archive: command.archive, tools }) }));
 }
 return withPair(sourceUrl, targetUrl, async (source, target) => ({ command: "admit", result: await admitTarget({ source, target, migrations: fileURLToPath(new URL("../db/migrations", import.meta.url)) }) }));
}

export async function main(argv: readonly string[], environment: Environment): Promise<number> {
 try {
  const output = await execute(parseCommand(argv), environment);
  process.stdout.write(JSON.stringify(output) + "\n");
  return 0;
 } catch (error) {
  if (error instanceof RecoveryRefused) {
   process.stderr.write(JSON.stringify({ event: "recovery_refused", reason: error.reason, ...error.detail }) + "\n");
   return error.reason === "usage" ? 64 : 78;
  }
  if (error instanceof LineageRefused) {
   process.stderr.write(JSON.stringify({ event: "recovery_refused", reason: error.reason }) + "\n");
   return 78;
  }
  const name = error instanceof Error ? error.name : "unknown";
  const message = error instanceof Error ? error.message : "";
  process.stderr.write(JSON.stringify({ event: "recovery_failed", error: bounded(name + ": " + message) }) + "\n");
  return 70;
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2), process.env);
